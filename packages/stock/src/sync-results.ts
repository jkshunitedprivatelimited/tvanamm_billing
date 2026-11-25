import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type Pool, type StockPool } from '@jksh/db';
import { StockError } from './errors';
import { requireRow } from './rows';

/**
 * Billing ⇄ Stock result loop and end-to-end reconciliation.
 *
 * consumeStockResults: reads Stock's SaleConsumptionProcessed /
 * SaleConsumptionFailed outbox rows and records one Billing row per source
 * event (billing.stock_sync_results, migration 0044), then acknowledges the
 * Stock row. Billing commits first; a crash before the acknowledgement just
 * replays an idempotent upsert.
 *
 * reconcileOutletDay: for one outlet and business date, follows every Billing
 * sale/refund event through delivery, Stock processing and the Billing result,
 * and checks each consumption's recipe requirement lines against the ledger.
 */

const RESULT_TYPES = ['SaleConsumptionProcessed', 'SaleConsumptionFailed'] as const;
const STATUSES = ['processed', 'negative_exception', 'refund_noop', 'failed'] as const;

export async function consumeStockResults(
  billing: Pool,
  stock: StockPool,
  opts: { limit?: number; maxAttempts?: number } = {},
): Promise<{ recorded: number; failed: number; deadLettered: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const maxAttempts = opts.maxAttempts ?? 5;
  const rows = await withStockActorContext(stock, stockSystemContext(), async (client) => {
    const r = await client.query<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
      attempts: number;
      source_event_id: string | null;
      source_event_type: string | null;
    }>(
      // Older rows lack sourceEventId in the payload; recover it from the consumption.
      `select o.id, o.event_type, o.payload, o.created_at, o.attempts,
              coalesce(o.payload->>'sourceEventId', sc.source_event_id::text) source_event_id,
              coalesce(o.payload->>'eventType', sc.event_type) source_event_type
         from stock_outbox.events o
         left join stock.sale_consumptions sc
           on o.aggregate_type = 'sale_consumption' and sc.id = o.aggregate_id
        where o.event_type = any($1::text[])
          and o.delivered_at is null and o.dead_lettered_at is null
        order by o.created_at, o.id
        limit $2`,
      [RESULT_TYPES, limit],
    );
    return r.rows;
  });

  const result = { recorded: 0, failed: 0, deadLettered: 0 };
  for (const row of rows) {
    const p = row.payload;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const status = row.event_type === 'SaleConsumptionFailed' ? 'failed' : str(p.status);
    try {
      if (
        !row.source_event_id ||
        !status ||
        !(STATUSES as readonly string[]).includes(status) ||
        (row.source_event_type !== 'SaleCompleted' && row.source_event_type !== 'SaleRefunded')
      )
        throw new Error('UnrecognisedResult');
      // A later success (after a manual retry) replaces an earlier failure; a
      // failure never overwrites a recorded success.
      await billing.query(
        `insert into billing.stock_sync_results
           (source_event_id, stock_outbox_id, event_type, bill_id, refund_id, outlet_id, status,
            negative_exceptions, processed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (source_event_id) do update
           set stock_outbox_id = excluded.stock_outbox_id, status = excluded.status,
               negative_exceptions = excluded.negative_exceptions,
               processed_at = excluded.processed_at, recorded_at = now()
         where billing.stock_sync_results.status = 'failed' and excluded.status <> 'failed'`,
        [
          row.source_event_id,
          row.id,
          row.source_event_type,
          str(p.billId),
          str(p.refundId),
          str(p.outletId),
          status,
          typeof p.negativeExceptions === 'number' ? p.negativeExceptions : 0,
          row.created_at,
        ],
      );
      await withStockActorContext(stock, stockSystemContext(), (c) =>
        c.query(
          `update stock_outbox.events set delivered_at = now(), attempts = attempts + 1
            where id = $1`,
          [row.id],
        ),
      );
      result.recorded += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const dead = attempts >= maxAttempts;
      await withStockActorContext(stock, stockSystemContext(), (c) =>
        c.query(
          `update stock_outbox.events
              set attempts = $2, last_error = $3,
                  dead_lettered_at = case when $4 then now() else dead_lettered_at end
            where id = $1`,
          [row.id, attempts, error instanceof Error ? error.message.slice(0, 80) : 'Error', dead],
        ),
      );
      result.failed += 1;
      if (dead) result.deadLettered += 1;
    }
  }
  return result;
}

export const reconcileOutletDaySchema = z.object({
  organizationId: z.uuid(),
  outletId: z.uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SyncCategory =
  | 'not_sent'
  | 'send_failed'
  | 'not_received'
  | 'waiting'
  | 'failed'
  | 'processed'
  | 'shortage'
  | 'refund_recorded'
  | 'result_missing';

export interface ReconciliationProblem {
  sourceEventId: string;
  eventType: string;
  billId: string | null;
  receiptNumber: string | null;
  category: SyncCategory;
  detail: string;
}

export interface LedgerMismatch {
  saleConsumptionId: string;
  billId: string | null;
  itemId: string;
  itemName: string;
  requiredBase: string;
  postedBase: string;
}

export interface OutletDayReconciliation {
  runId: string;
  outletId: string;
  businessDate: string;
  sales: number;
  refunds: number;
  counts: Record<SyncCategory, number>;
  problems: ReconciliationProblem[];
  ledgerMismatches: LedgerMismatch[];
  /** Everything accounted for and the ledger agrees with every requirement. */
  balanced: boolean;
}

const emptyCounts = (): Record<SyncCategory, number> => ({
  not_sent: 0,
  send_failed: 0,
  not_received: 0,
  waiting: 0,
  failed: 0,
  processed: 0,
  shortage: 0,
  refund_recorded: 0,
  result_missing: 0,
});

const DETAIL: Record<SyncCategory, string> = {
  not_sent: 'Waiting to be sent to Stock',
  send_failed: 'Sending to Stock failed after retries',
  not_received: 'Marked sent by Billing but missing in Stock',
  waiting: 'Received by Stock, not processed yet',
  failed: 'Stock could not process it after retries',
  processed: 'Processed',
  shortage: 'Processed with recorded stock below zero',
  refund_recorded: 'Refund recorded (materials not restored)',
  result_missing: 'Processed in Stock; Billing has not recorded the result yet',
};

const PROBLEMS: readonly SyncCategory[] = [
  'not_sent',
  'send_failed',
  'not_received',
  'waiting',
  'failed',
  'result_missing',
];

export async function reconcileOutletDay(
  billing: Pool,
  stock: StockPool,
  input: unknown,
): Promise<OutletDayReconciliation> {
  const parsed = reconcileOutletDaySchema.safeParse(input);
  if (!parsed.success) throw new StockError('validation', 'Choose an outlet and a date');
  const { organizationId, outletId, businessDate } = parsed.data;

  const billingRows = (
    await billing.query<{
      id: string;
      event_type: string;
      status: string;
      payload: Record<string, unknown>;
      result_status: string | null;
    }>(
      `select e.id, e.event_type, e.status, e.payload, r.status result_status
         from outbox.events e
         left join billing.stock_sync_results r on r.source_event_id = e.id
        where e.organization_id = $1 and e.outlet_id = $2
          and e.event_type in ('SaleCompleted', 'SaleRefunded')
          and coalesce(e.payload->>'businessDate',
                       ((e.created_at at time zone 'Asia/Kolkata')::date)::text) = $3
        order by e.created_at, e.id`,
      [organizationId, outletId, businessDate],
    )
  ).rows;
  const ids = billingRows.map((r) => r.id);

  return withStockActorContext(stock, stockSystemContext(), async (client) => {
    const inbox = new Map(
      (
        await client.query<{
          source_event_id: string;
          processed_at: Date | null;
          dead_lettered_at: Date | null;
        }>(
          `select source_event_id, processed_at, dead_lettered_at from stock_inbox.events
            where source_event_id = any($1::uuid[])`,
          [ids],
        )
      ).rows.map((r) => [r.source_event_id, r]),
    );
    const consumptions = new Map(
      (
        await client.query<{ id: string; source_event_id: string; status: string }>(
          `select id, source_event_id, status::text from stock.sale_consumptions
            where source_event_id = any($1::uuid[])`,
          [ids],
        )
      ).rows.map((r) => [r.source_event_id, r]),
    );

    const counts = emptyCounts();
    const problems: ReconciliationProblem[] = [];
    for (const e of billingRows) {
      const recv = inbox.get(e.id);
      const done = consumptions.get(e.id);
      let category: SyncCategory;
      if (done) {
        category =
          done.status === 'negative_exception'
            ? 'shortage'
            : done.status === 'refund_noop'
              ? 'refund_recorded'
              : done.status === 'failed'
                ? 'failed'
                : 'processed';
        if (category !== 'failed' && (!e.result_status || e.result_status === 'failed'))
          category = 'result_missing';
      } else if (recv?.dead_lettered_at) category = 'failed';
      else if (recv) category = 'waiting';
      else if (e.status === 'dead_letter') category = 'send_failed';
      else if (e.status === 'delivered') category = 'not_received';
      else category = 'not_sent';
      counts[category] += 1;
      if (PROBLEMS.includes(category))
        problems.push({
          sourceEventId: e.id,
          eventType: e.event_type,
          billId: typeof e.payload.billId === 'string' ? e.payload.billId : null,
          receiptNumber:
            typeof e.payload.receiptNumber === 'string' ? e.payload.receiptNumber : null,
          category,
          detail: DETAIL[category],
        });
    }

    // Requirement lines vs. posted ledger movements, per consumption and item.
    const consumptionIds = [...consumptions.values()].map((c) => c.id);
    const mismatches = (
      await client.query<{
        sale_consumption_id: string;
        bill_id: string | null;
        item_id: string;
        item_name: string;
        required: string;
        posted: string;
      }>(
        `with req as (
           select l.sale_consumption_id, l.item_id, sum(l.qty_base) required
             from stock.sale_consumption_lines l
            where l.sale_consumption_id = any($1::uuid[])
            group by 1, 2),
         posted as (
           select m.source_doc_id sale_consumption_id, m.item_id, -sum(m.quantity) posted
             from stock.stock_movements m
            where m.source_doc_type = 'sale_consumption' and m.source_doc_id = any($1::uuid[])
            group by 1, 2)
         select coalesce(req.sale_consumption_id, posted.sale_consumption_id) sale_consumption_id,
                sc.bill_id, coalesce(req.item_id, posted.item_id) item_id, i.name item_name,
                coalesce(req.required, 0)::text required, coalesce(posted.posted, 0)::text posted
           from req full join posted
             on posted.sale_consumption_id = req.sale_consumption_id
            and posted.item_id = req.item_id
           join stock.sale_consumptions sc
             on sc.id = coalesce(req.sale_consumption_id, posted.sale_consumption_id)
           join stock.items i on i.id = coalesce(req.item_id, posted.item_id)
          where abs(coalesce(req.required, 0) - coalesce(posted.posted, 0)) > 0.000001
          limit 200`,
        [consumptionIds],
      )
    ).rows.map((m) => ({
      saleConsumptionId: m.sale_consumption_id,
      billId: m.bill_id,
      itemId: m.item_id,
      itemName: m.item_name,
      requiredBase: m.required,
      postedBase: m.posted,
    }));

    const discrepancies = problems.length + mismatches.length;
    const run = await client.query<{ id: string }>(
      `insert into stock.reconciliation_runs (organization_id, kind, finished_at, discrepancies, report)
       values ($1, 'outlet_day', now(), $2, $3) returning id`,
      [
        organizationId,
        discrepancies,
        JSON.stringify({
          outletId,
          businessDate,
          counts,
          problems: problems.slice(0, 200),
          ledgerMismatches: mismatches,
        }),
      ],
    );
    return {
      runId: requireRow(run, 'reconciliation run').id,
      outletId,
      businessDate,
      sales: billingRows.filter((r) => r.event_type === 'SaleCompleted').length,
      refunds: billingRows.filter((r) => r.event_type === 'SaleRefunded').length,
      counts,
      problems: problems.slice(0, 200),
      ledgerMismatches: mismatches,
      balanced: discrepancies === 0,
    };
  });
}
