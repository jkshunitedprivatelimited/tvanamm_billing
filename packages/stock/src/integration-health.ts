import { withStockActorContext, stockSystemContext, type Pool, type StockPool } from '@jksh/db';

/**
 * Operational health of the Billing → Stock event pipeline: what is stuck in
 * each queue and which inbound events dead-lettered, so a person can see and
 * recover from a break without shell access.
 */

export interface DeadLetter {
  id: string;
  source: string;
  sourceEventId: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: string;
  receivedAt: string;
}

export interface IntegrationHealth {
  workers: {
    worker: string;
    state: string;
    startedAt: string;
    finishedAt: string | null;
    lastSuccessAt: string | null;
    stale: boolean;
  }[];
  lowStockNotifications: {
    pending: number;
    deadLettered: number;
    failures: { id: string; outletId: string; attempts: number }[];
  };
  billingOutbox: { pending: number; deadLetter: number; oldestPendingAt: string | null };
  stockInbox: { unprocessed: number; deadLettered: number; oldestUnprocessedAt: string | null };
  stockOutbox: { undelivered: number; deadLettered: number };
  lastReconciliation: {
    startedAt: string;
    finishedAt: string | null;
    discrepancies: number;
    report: unknown;
  } | null;
  deadLetters: DeadLetter[];
  billingDeadLetters: {
    id: string;
    eventType: string;
    eventVersion: number;
    attempts: number;
    createdAt: string;
  }[];
}

export async function getIntegrationHealth(
  billingPool: Pool,
  stockPool: StockPool,
  organizationId: string,
): Promise<IntegrationHealth> {
  const bo = await billingPool.query<{ status: string; n: string; oldest: Date | null }>(
    `select status, count(*)::int as n, min(created_at) as oldest
       from outbox.events
      where event_type in ('SaleCompleted', 'SaleRefunded') and organization_id = $1
      group by status`,
    [organizationId],
  );
  const billingDead = await billingPool.query<{
    id: string;
    event_type: string;
    event_version: number;
    attempts: number;
    created_at: Date;
  }>(
    `select id,event_type,event_version,attempts,created_at from outbox.events
     where organization_id=$1 and status='dead_letter' and event_type in ('SaleCompleted','SaleRefunded')
     order by created_at desc limit 100`,
    [organizationId],
  );
  const boByStatus = new Map(bo.rows.map((r) => [r.status, r]));

  return withStockActorContext(stockPool, stockSystemContext(), async (client) => {
    const workers = await client.query<{
      worker: string;
      state: string;
      started_at: Date;
      finished_at: Date | null;
      last_success_at: Date | null;
      stale: boolean;
    }>(
      `select *, started_at < now()-interval '5 minutes' as stale from stock.worker_status where organization_id=$1 order by worker`,
      [organizationId],
    );
    const notifications = await client.query<{ pending: string; dead: string }>(
      `select count(*) filter (where e.delivered_at is null and e.dead_lettered_at is null) pending,
       count(*) filter (where e.dead_lettered_at is not null) dead
       from stock.low_stock_events e join stock.low_stock_rules r on r.id=e.rule_id where r.organization_id=$1`,
      [organizationId],
    );
    const failedNotifications = await client.query<{
      id: string;
      outlet_id: string;
      attempts: number;
    }>(
      `select e.id::text, r.outlet_id, e.attempts from stock.low_stock_events e
       join stock.low_stock_rules r on r.id=e.rule_id
       where r.organization_id=$1 and e.dead_lettered_at is not null order by e.id limit 100`,
      [organizationId],
    );
    const inbox = await client.query<{
      unprocessed: string;
      dead: string;
      oldest: Date | null;
    }>(
      `select
         count(*) filter (where processed_at is null and dead_lettered_at is null) as unprocessed,
         count(*) filter (where dead_lettered_at is not null) as dead,
         min(received_at) filter (where processed_at is null and dead_lettered_at is null) as oldest
       from stock_inbox.events`,
    );
    const sOut = await client.query<{ undelivered: string; dead: string }>(
      `select
         count(*) filter (where delivered_at is null and dead_lettered_at is null) as undelivered,
         count(*) filter (where dead_lettered_at is not null) as dead
       from stock_outbox.events
      where event_type in ('SaleConsumptionProcessed', 'SaleConsumptionFailed')`,
    );
    const dl = await client.query<{
      id: string;
      source: string;
      source_event_id: string;
      event_type: string;
      attempts: number;
      last_error: string | null;
      dead_lettered_at: Date;
      received_at: Date;
    }>(
      `select id, source, source_event_id, event_type, attempts, last_error,
              dead_lettered_at, received_at
         from stock_inbox.events
        where dead_lettered_at is not null
        order by dead_lettered_at desc limit 100`,
    );
    const recon = await client.query<{
      started_at: Date;
      finished_at: Date | null;
      discrepancies: number;
      report: unknown;
    }>(
      `select started_at, finished_at, discrepancies, report
         from stock.reconciliation_runs
        where organization_id = $1
        order by started_at desc limit 1`,
      [organizationId],
    );

    const ib = inbox.rows[0];
    const so = sOut.rows[0];
    const rc = recon.rows[0];
    return {
      workers: workers.rows.map((r) => ({
        worker: r.worker,
        state: r.state,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at?.toISOString() ?? null,
        lastSuccessAt: r.last_success_at?.toISOString() ?? null,
        stale: r.stale,
      })),
      lowStockNotifications: {
        pending: Number(notifications.rows[0]?.pending ?? 0),
        deadLettered: Number(notifications.rows[0]?.dead ?? 0),
        failures: failedNotifications.rows.map((r) => ({
          id: r.id,
          outletId: r.outlet_id,
          attempts: r.attempts,
        })),
      },
      billingOutbox: {
        pending: boByStatus.get('pending')?.n ? Number(boByStatus.get('pending')?.n) : 0,
        deadLetter: boByStatus.get('dead_letter')?.n ? Number(boByStatus.get('dead_letter')?.n) : 0,
        oldestPendingAt: boByStatus.get('pending')?.oldest?.toISOString() ?? null,
      },
      stockInbox: {
        unprocessed: Number(ib?.unprocessed ?? 0),
        deadLettered: Number(ib?.dead ?? 0),
        oldestUnprocessedAt: ib?.oldest?.toISOString() ?? null,
      },
      stockOutbox: {
        undelivered: Number(so?.undelivered ?? 0),
        deadLettered: Number(so?.dead ?? 0),
      },
      lastReconciliation: rc
        ? {
            startedAt: rc.started_at.toISOString(),
            finishedAt: rc.finished_at?.toISOString() ?? null,
            discrepancies: rc.discrepancies,
            report: rc.report,
          }
        : null,
      billingDeadLetters: billingDead.rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        eventVersion: r.event_version,
        attempts: r.attempts,
        createdAt: r.created_at.toISOString(),
      })),
      deadLetters: dl.rows.map((r) => ({
        id: r.id,
        source: r.source,
        sourceEventId: r.source_event_id,
        eventType: r.event_type,
        attempts: r.attempts,
        lastError: r.last_error,
        deadLetteredAt: r.dead_lettered_at.toISOString(),
        receivedAt: r.received_at.toISOString(),
      })),
    };
  });
}

/**
 * Clear a dead-letter so the next processStockInbox run picks the event up
 * again. Returns false if the id is not a current dead-letter.
 */
export async function retryInboxDeadLetter(
  stockPool: StockPool,
  eventId: string,
): Promise<boolean> {
  return withStockActorContext(stockPool, stockSystemContext(), async (client) => {
    const r = await client.query(
      `update stock_inbox.events
          set dead_lettered_at = null, attempts = 0, last_error = null, next_attempt_at = now()
        where id = $1 and dead_lettered_at is not null`,
      [eventId],
    );
    return (r.rowCount ?? 0) > 0;
  });
}

/** Requeue one scoped transfer after its cause has been reviewed; no payload edits. */
export async function retryBillingDeadLetter(
  pool: Pool,
  eventId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await pool.query(
    `update outbox.events set status='pending', attempts=0, next_attempt_at=now()
     where id=$1 and organization_id=$2 and status='dead_letter'
       and event_type in ('SaleCompleted','SaleRefunded')`,
    [eventId, organizationId],
  );
  return (result.rowCount ?? 0) > 0;
}
