import { withStockActorContext, stockSystemContext, type Pool, type StockPool } from '@jksh/db';
import { ingestInboundEvent, signEventPayload } from './events';
import { processSaleCompleted, processSaleRefunded } from './consumption';
import { requireRow } from './rows';

/**
 * Move Billing's SaleCompleted / SaleRefunded outbox rows into the Stock inbox.
 * In this monorepo Billing and Stock deploy together, so this runs in-process;
 * a split deployment would put an HTTP hop here without changing the contract.
 * Billing's outbox row id is the idempotency key on the Stock side.
 */
export async function deliverBillingEventsToStock(
  billingPool: Pool,
  stockPool: StockPool,
  opts: { limit?: number } = {},
): Promise<{ delivered: number; skipped: number }> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const { rows } = await billingPool.query<{
    id: string;
    event_type: string;
    correlation_id: string;
    organization_id: string;
    franchise_id: string | null;
    outlet_id: string;
    payload: unknown;
    created_at: string;
  }>(
    `select id, event_type, correlation_id, organization_id, franchise_id, outlet_id, payload, created_at
       from outbox.events
      where status = 'pending' and event_type in ('SaleCompleted', 'SaleRefunded')
      order by created_at asc
      limit $1`,
    [limit],
  );

  let delivered = 0;
  let skipped = 0;
  for (const row of rows) {
    const envelope = {
      eventId: row.id,
      eventType: row.event_type as 'SaleCompleted' | 'SaleRefunded',
      eventVersion: 1,
      occurredAt: new Date(row.created_at).toISOString(),
      source: 'billing' as const,
      correlationId: row.correlation_id,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      signature: signEventPayload(row.payload),
      payload: row.payload,
    };
    const res = await withStockActorContext(stockPool, stockSystemContext(), (c) =>
      ingestInboundEvent(c, envelope),
    );
    if (res.duplicate) skipped += 1;
    else delivered += 1;
    await billingPool.query(
      `update outbox.events set status = 'delivered', delivered_at = now(), attempts = attempts + 1
        where id = $1`,
      [row.id],
    );
  }
  return { delivered, skipped };
}

/**
 * Process unhandled Stock inbox events. A poison event is retried with backoff
 * and dead-lettered after `maxAttempts`, without blocking the rest of the batch
 * (`stock-v1-build-plan.md` "Offline and Reliability").
 */
export async function processStockInbox(
  stockPool: StockPool,
  opts: { limit?: number; maxAttempts?: number } = {},
): Promise<{ processed: number; failed: number; deadLettered: number }> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const maxAttempts = opts.maxAttempts ?? 5;

  const pending = await withStockActorContext(stockPool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      source_event_id: string;
      event_type: string;
      attempts: number;
    }>(
      `select id, source_event_id, event_type, attempts from stock_inbox.events
        where processed_at is null and dead_lettered_at is null
        order by received_at asc limit $1`,
      [limit],
    );
    return rows;
  });

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const evt of pending) {
    try {
      if (evt.event_type === 'SaleCompleted') {
        await processSaleCompleted(stockPool, evt.source_event_id);
      } else if (evt.event_type === 'SaleRefunded') {
        await processSaleRefunded(stockPool, evt.source_event_id);
      } else {
        throw new Error(`unknown inbox event type ${evt.event_type}`);
      }
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const nextAttempts = evt.attempts + 1;
      const dead = nextAttempts >= maxAttempts;
      await withStockActorContext(stockPool, stockSystemContext(), (client) =>
        client.query(
          `update stock_inbox.events
              set attempts = $2, last_error = $3,
                  dead_lettered_at = case when $4 then now() else dead_lettered_at end
            where id = $1`,
          [evt.id, nextAttempts, message, dead],
        ),
      );
      failed += 1;
      if (dead) deadLettered += 1;
    }
  }
  return { processed, failed, deadLettered };
}

export interface ReconciliationReport {
  runId: string;
  unprocessedInbox: number;
  deadLetteredInbox: number;
  openNegativeExceptions: number;
  undeliveredOutbox: number;
}

/**
 * Compare the cross-system pipeline's ends and record a run. A non-zero
 * `unprocessedInbox` / `deadLetteredInbox` is the operational signal Central
 * watches (`billing-stock-recipe-contract.md` "Failure Handling").
 */
export async function reconcileCrossSystem(
  stockPool: StockPool,
  organizationId: string,
): Promise<ReconciliationReport> {
  return withStockActorContext(stockPool, stockSystemContext(), async (client) => {
    const run = await client.query<{ id: string }>(
      `insert into stock.reconciliation_runs (organization_id, kind) values ($1,'cross_system')
       returning id`,
      [organizationId],
    );
    const runId = requireRow(run, 'reconciliation run').id;

    const unprocessed = await client.query<{ n: string }>(
      `select count(*) as n from stock_inbox.events
        where processed_at is null and dead_lettered_at is null`,
    );
    const dead = await client.query<{ n: string }>(
      'select count(*) as n from stock_inbox.events where dead_lettered_at is not null',
    );
    const negs = await client.query<{ n: string }>(
      `select count(*) as n from stock.negative_stock_exceptions e
         join stock.sale_consumptions s on s.id = e.sale_consumption_id
        where s.organization_id = $1 and e.resolved_at is null`,
      [organizationId],
    );
    const outbox = await client.query<{ n: string }>(
      `select count(*) as n from stock_outbox.events
        where delivered_at is null and dead_lettered_at is null`,
    );

    const report: ReconciliationReport = {
      runId,
      unprocessedInbox: Number(unprocessed.rows[0]?.n ?? '0'),
      deadLetteredInbox: Number(dead.rows[0]?.n ?? '0'),
      openNegativeExceptions: Number(negs.rows[0]?.n ?? '0'),
      undeliveredOutbox: Number(outbox.rows[0]?.n ?? '0'),
    };
    const discrepancies =
      report.unprocessedInbox + report.deadLetteredInbox + report.undeliveredOutbox;
    await client.query(
      `update stock.reconciliation_runs
          set finished_at = now(), discrepancies = $2, report = $3 where id = $1`,
      [runId, discrepancies, JSON.stringify(report)],
    );
    return report;
  });
}
