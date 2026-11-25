import { withStockActorContext, stockSystemContext, type Pool, type StockPool } from '@jksh/db';
import { ingestInboundEvent, recordStockOutbox, signEventPayload } from './events';
import { processSaleCompleted, processSaleRefunded } from './consumption';
import { requireRow } from './rows';

export interface StockEventScope {
  organizationId: string;
  outletIds: string[];
  notBefore: string;
}

/**
 * Move Billing's SaleCompleted / SaleRefunded outbox rows into the Stock inbox.
 * In this monorepo Billing and Stock deploy together, so this runs in-process;
 * a split deployment would put an HTTP hop here without changing the contract.
 * Billing's outbox row id is the idempotency key on the Stock side.
 */
export async function deliverBillingEventsToStock(
  billingPool: Pool,
  stockPool: StockPool,
  opts: { limit?: number; maxAttempts?: number; scope?: StockEventScope } = {},
): Promise<{ delivered: number; skipped: number; failed: number; deadLettered: number }> {
  const limit = batchLimit(opts.limit);
  const maxAttempts = batchLimit(opts.maxAttempts ?? 5);
  const result = { delivered: 0, skipped: 0, failed: 0, deadLettered: 0 };
  for (let i = 0; i < limit; i += 1) {
    const client = await billingPool.connect();
    try {
      await client.query('begin');
      // The row lock is the durable claim. A crash rolls it back; duplicate
      // delivery after Stock commits is harmless on the unique inbox key.
      const { rows } = await client.query<{
        id: string;
        event_type: string;
        event_version: number;
        correlation_id: string;
        organization_id: string;
        franchise_id: string | null;
        outlet_id: string;
        payload: unknown;
        created_at: string;
        attempts: number;
      }>(
        `select id, event_type, event_version, correlation_id, organization_id,
                franchise_id, outlet_id, payload, created_at, attempts
           from outbox.events
          where status = 'pending' and next_attempt_at <= now()
            and event_type in ('SaleCompleted', 'SaleRefunded')
            and ($1::uuid is null or organization_id=$1)
            and ($2::uuid[] is null or outlet_id=any($2))
            and ($3::timestamptz is null or created_at >= $3)
          order by created_at asc, id limit 1 for update skip locked`,
        [
          opts.scope?.organizationId ?? null,
          opts.scope?.outletIds ?? null,
          opts.scope?.notBefore ?? null,
        ],
      );
      const row = rows[0];
      if (!row) {
        await client.query('commit');
        break;
      }
      try {
        const envelope = {
          eventId: row.id,
          eventType: row.event_type,
          eventVersion: row.event_version,
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
        if (res.duplicate) result.skipped += 1;
        else result.delivered += 1;
        await client.query(
          `update outbox.events set status = 'delivered', delivered_at = now(),
                  attempts = attempts + 1 where id = $1`,
          [row.id],
        );
      } catch {
        const attempts = row.attempts + 1;
        const dead = attempts >= maxAttempts;
        await client.query(
          `update outbox.events set attempts = $2, status = $3,
                  next_attempt_at = now() + $4 * interval '1 second' where id = $1`,
          [row.id, attempts, dead ? 'dead_letter' : 'pending', retryDelay(attempts)],
        );
        result.failed += 1;
        if (dead) result.deadLettered += 1;
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  return result;
}

function batchLimit(value = 100): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Batch limit must be a positive integer');
  return Math.min(value, 500);
}

function retryDelay(attempts: number): number {
  return Math.min(30 * 2 ** Math.min(attempts - 1, 7), 3600);
}

/**
 * Process unhandled Stock inbox events. A poison event is retried with backoff
 * and dead-lettered after `maxAttempts`, without blocking the rest of the batch
 * (`stock-v1-build-plan.md` "Offline and Reliability").
 */
export async function processStockInbox(
  stockPool: StockPool,
  opts: { limit?: number; maxAttempts?: number; scope?: StockEventScope } = {},
): Promise<{ processed: number; failed: number; deadLettered: number }> {
  const limit = batchLimit(opts.limit);
  const maxAttempts = batchLimit(opts.maxAttempts ?? 5);
  // A session lock avoids two scheduled/manual processors spending a retry
  // simultaneously. Release it even when the cycle fails.
  const lock = await stockPool.connect();
  try {
    const claim = await lock.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtextextended('stock-inbox-worker', 0)) as acquired",
    );
    if (!claim.rows[0]?.acquired) return { processed: 0, failed: 0, deadLettered: 0 };
    return await processClaimedInbox(stockPool, limit, maxAttempts, opts.scope);
  } finally {
    await lock
      .query("select pg_advisory_unlock(hashtextextended('stock-inbox-worker', 0))")
      .catch(() => undefined);
    lock.release(true);
  }
}

async function processClaimedInbox(
  stockPool: StockPool,
  limit: number,
  maxAttempts: number,
  scope?: StockEventScope,
) {
  const pending = await withStockActorContext(stockPool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      source_event_id: string;
      event_type: string;
      attempts: number;
    }>(
      `select id, source_event_id, event_type, attempts from stock_inbox.events
        where processed_at is null and dead_lettered_at is null and next_attempt_at <= now()
          and ($2::uuid is null or exists (select 1 from stock.outlet_stock_settings s
            where s.organization_id=$2 and s.outlet_id::text=payload->>'outletId'))
          and ($3::text[] is null or payload->>'outletId'=any($3))
          and ($4::timestamptz is null or source_occurred_at >= $4)
        order by received_at asc limit $1`,
      [limit, scope?.organizationId ?? null, scope?.outletIds ?? null, scope?.notBefore ?? null],
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
      // Store a bounded classification, never a database error containing row data.
      const message = error instanceof Error ? error.name : 'ProcessingError';
      const nextAttempts = evt.attempts + 1;
      const dead = nextAttempts >= maxAttempts;
      await withStockActorContext(stockPool, stockSystemContext(), async (client) => {
        const updated = await client.query<{ payload: Record<string, unknown> }>(
          `update stock_inbox.events
              set attempts = $2, last_error = $3,
                  dead_lettered_at = case when $4 then now() else dead_lettered_at end,
                  next_attempt_at = now() + $5 * interval '1 second'
            where id = $1 and processed_at is null
          returning payload`,
          [evt.id, nextAttempts, message, dead, retryDelay(nextAttempts)],
        );
        // Tell Billing this bill will not be consumed until someone retries it.
        const payload = updated.rows[0]?.payload;
        if (dead && payload)
          await recordStockOutbox(client, {
            aggregateType: 'inbox_event',
            aggregateId: evt.id,
            eventType: 'SaleConsumptionFailed',
            payload: {
              sourceEventId: evt.source_event_id,
              eventType: evt.event_type,
              billId: typeof payload.billId === 'string' ? payload.billId : null,
              refundId: typeof payload.refundId === 'string' ? payload.refundId : null,
              outletId: typeof payload.outletId === 'string' ? payload.outletId : null,
              status: 'failed',
              reason: message,
            },
          });
      });
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
        where e.organization_id = $1 and e.resolved_at is null`,
      [organizationId],
    );
    const outbox = await client.query<{ n: string }>(
      // Only result events have a consumer (consumeStockResults).
      `select count(*) as n from stock_outbox.events
        where delivered_at is null and dead_lettered_at is null
          and event_type in ('SaleConsumptionProcessed', 'SaleConsumptionFailed')`,
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
