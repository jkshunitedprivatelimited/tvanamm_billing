import { createHash, randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import { emitNotification } from './notification';
import { recordAudit } from './audit';
import type { RequestMeta } from './admin-auth';

/** Bills stay in the active POS history for this many days; older records are
 *  what a retention export captures before any future archive. */
export const ACTIVE_WINDOW_DAYS = 60;
/** Warn the owner once records are this close to leaving active history. */
const WARN_BAND_DAYS = 7;

interface OutletRef {
  id: string;
  display_name: string;
  timezone: string;
}

async function outletsInScope(
  client: PoolClient,
  actor: ActorContext,
  filter: { franchiseId?: string; outletId?: string },
): Promise<OutletRef[]> {
  const params: unknown[] = [actor.scope.organizationId];
  let where = `organization_id = $1`;
  if (actor.scope.franchiseId) {
    params.push(actor.scope.franchiseId);
    where += ` and franchise_id = $${String(params.length)}`;
  } else if (filter.franchiseId) {
    params.push(filter.franchiseId);
    where += ` and franchise_id = $${String(params.length)}`;
  }
  if (filter.outletId) {
    params.push(filter.outletId);
    where += ` and id = $${String(params.length)}`;
  }
  const { rows } = await client.query<OutletRef>(
    `select id, display_name, timezone from billing.outlets where ${where} order by display_name`,
    params,
  );
  return rows;
}

export interface RetentionStatus {
  activeWindowDays: number;
  /** Bills already past the active window (would move to archive at day-60). */
  archivableCount: number;
  /** Bills that leave active history within the next WARN_BAND_DAYS. */
  expiringCount: number;
  /** ISO date: bills on or before this leave active history within the band. */
  expiringOnOrBefore: string;
  oldestActiveDate: string | null;
  recentExports: {
    id: string;
    fromDate: string;
    toDate: string;
    kind: string;
    billCount: number;
    createdAt: string;
  }[];
}

export async function getRetentionStatus(
  pool: Pool,
  actor: ActorContext,
  filter: { franchiseId?: string; outletId?: string } = {},
): Promise<RetentionStatus> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlets = await outletsInScope(client, actor, filter);
    const ids = outlets.map((o) => o.id);
    const tz = outlets[0]?.timezone ?? 'Asia/Kolkata';
    const today = businessDateString(new Date(), tz);
    const cutoff = businessDateString(new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000), tz);
    const warnEdge = businessDateString(
      new Date(Date.now() - (ACTIVE_WINDOW_DAYS - WARN_BAND_DAYS) * 86_400_000),
      tz,
    );

    if (ids.length === 0) {
      return {
        activeWindowDays: ACTIVE_WINDOW_DAYS,
        archivableCount: 0,
        expiringCount: 0,
        expiringOnOrBefore: warnEdge,
        oldestActiveDate: null,
        recentExports: [],
      };
    }

    const counts = await client.query<{
      archivable: string;
      expiring: string;
      oldest: string | null;
    }>(
      `select
         count(*) filter (where business_date < $2) as archivable,
         count(*) filter (where business_date >= $2 and business_date <= $3) as expiring,
         min(business_date)::text as oldest
       from billing.bills
      where outlet_id = any($1::uuid[]) and business_date <= $4`,
      [ids, cutoff, warnEdge, today],
    );

    const exports = await client.query<{
      id: string;
      from_date: string;
      to_date: string;
      kind: string;
      bill_count: number;
      created_at: Date;
    }>(
      `select id, from_date::text as from_date, to_date::text as to_date, kind, bill_count, created_at
         from billing.retention_exports
        where organization_id = $1
        order by created_at desc limit 10`,
      [actor.scope.organizationId],
    );

    const row = counts.rows[0];
    return {
      activeWindowDays: ACTIVE_WINDOW_DAYS,
      archivableCount: Number(row?.archivable ?? 0),
      expiringCount: Number(row?.expiring ?? 0),
      expiringOnOrBefore: warnEdge,
      oldestActiveDate: row?.oldest ?? null,
      recentExports: exports.rows.map((e) => ({
        id: e.id,
        fromDate: e.from_date,
        toDate: e.to_date,
        kind: e.kind,
        billCount: e.bill_count,
        createdAt: e.created_at.toISOString(),
      })),
    };
  });
}

export interface ExportBillsCommand {
  from: string; // YYYY-MM-DD
  to: string;
  franchiseId?: string;
  outletId?: string;
  kind?: 'owner_export' | 'canonical_day60';
}

export interface BillsWorkbook {
  range: { from: string; to: string };
  bills: Record<string, unknown>[];
  billItems: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
  refundItems: Record<string, unknown>[];
  summary: {
    billCount: number;
    lineCount: number;
    paymentCount: number;
    refundCount: number;
    grossSales: string;
    discountTotal: string;
    refundTotal: string;
  };
  exportId: string;
  checksum: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function exportBillsWorkbook(
  pool: Pool,
  actor: ActorContext,
  cmd: ExportBillsCommand,
  meta: RequestMeta = {},
): Promise<BillsWorkbook> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  if (!DATE_RE.test(cmd.from) || !DATE_RE.test(cmd.to)) {
    throw new IdentityError('validation', 'from and to must be YYYY-MM-DD');
  }
  if (cmd.from > cmd.to) throw new IdentityError('validation', 'from must not be after to');

  const correlationId = meta.correlationId ?? randomUUID();

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlets = await outletsInScope(client, actor, {
      ...(cmd.franchiseId ? { franchiseId: cmd.franchiseId } : {}),
      ...(cmd.outletId ? { outletId: cmd.outletId } : {}),
    });
    const ids = outlets.map((o) => o.id);
    const nameById = new Map(outlets.map((o) => [o.id, o.display_name]));

    const empty: BillsWorkbook = {
      range: { from: cmd.from, to: cmd.to },
      bills: [],
      billItems: [],
      payments: [],
      refunds: [],
      refundItems: [],
      summary: {
        billCount: 0,
        lineCount: 0,
        paymentCount: 0,
        refundCount: 0,
        grossSales: '0.00',
        discountTotal: '0.00',
        refundTotal: '0.00',
      },
      exportId: randomUUID(),
      checksum: 'da39a3ee', // sha1("") prefix — nothing exported
    };
    if (ids.length === 0) return empty;

    const bills = await client.query<Record<string, string>>(
      `select id, receipt_number, business_date::text as business_date, outlet_id,
              employee_name, payment_method, is_complimentary, is_offline,
              subtotal, discount_total, round_adjustment, final_total,
              customer_name, committed_at
         from billing.bills
        where outlet_id = any($1::uuid[]) and business_date between $2 and $3
        order by business_date, committed_at`,
      [ids, cmd.from, cmd.to],
    );
    const billIds = bills.rows.map((b) => b.id);

    const lines = billIds.length
      ? await client.query<Record<string, string>>(
          `select bill_id, line_no, item_name, quantity, unit_price, gst_rate,
                  base_total, discount, final_total, note, combo_name, offer_label
             from billing.bill_lines where bill_id = any($1::uuid[])
            order by bill_id, line_no`,
          [billIds],
        )
      : { rows: [] as Record<string, string>[] };

    const payments = billIds.length
      ? await client.query<Record<string, string>>(
          `select bill_id, method, amount, round_adjustment, reference, captured_at
             from billing.payments where bill_id = any($1::uuid[]) order by bill_id`,
          [billIds],
        )
      : { rows: [] as Record<string, string>[] };

    const refunds = await client.query<Record<string, string>>(
      `select id, bill_id, kind, amount, payout_method, payout_reference, reason,
              actor_name, created_at
         from billing.refunds
        where outlet_id = any($1::uuid[]) and created_at::date between $2 and $3
        order by created_at`,
      [ids, cmd.from, cmd.to],
    );
    const refundIds = refunds.rows.map((r) => r.id);
    const refundLines = refundIds.length
      ? await client.query<Record<string, string>>(
          `select rl.refund_id, rl.bill_line_id, rl.quantity, rl.amount, bl.item_name
             from billing.refund_lines rl
             join billing.bill_lines bl on bl.id = rl.bill_line_id
            where rl.refund_id = any($1::uuid[])`,
          [refundIds],
        )
      : { rows: [] as Record<string, string>[] };

    const gross = bills.rows.reduce((s, b) => s + Number(b.subtotal), 0);
    const discount = bills.rows.reduce((s, b) => s + Number(b.discount_total), 0);
    const refundTotal = refunds.rows.reduce((s, r) => s + Number(r.amount), 0);

    const workbook: Omit<BillsWorkbook, 'exportId' | 'checksum'> = {
      range: { from: cmd.from, to: cmd.to },
      bills: bills.rows.map((b) => {
        const oid = b.outlet_id ?? '';
        return { ...b, outlet_name: nameById.get(oid) ?? oid };
      }),
      billItems: lines.rows,
      payments: payments.rows,
      refunds: refunds.rows,
      refundItems: refundLines.rows,
      summary: {
        billCount: bills.rows.length,
        lineCount: lines.rows.length,
        paymentCount: payments.rows.length,
        refundCount: refunds.rows.length,
        grossSales: gross.toFixed(2),
        discountTotal: discount.toFixed(2),
        refundTotal: refundTotal.toFixed(2),
      },
    };

    const checksum = createHash('sha256')
      .update(JSON.stringify(workbook.bills) + JSON.stringify(workbook.refunds))
      .digest('hex');
    const exportId = randomUUID();

    await client.query(
      `insert into billing.retention_exports
         (id, organization_id, franchise_id, outlet_id, from_date, to_date, kind,
          bill_count, line_count, payment_count, refund_count, checksum, actor_account_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        exportId,
        actor.scope.organizationId,
        actor.scope.franchiseId ?? cmd.franchiseId ?? null,
        cmd.outletId ?? null,
        cmd.from,
        cmd.to,
        cmd.kind ?? 'owner_export',
        workbook.summary.billCount,
        workbook.summary.lineCount,
        workbook.summary.paymentCount,
        workbook.summary.refundCount,
        checksum,
        actor.kind === 'admin' ? (actor.accountId ?? null) : null,
      ],
    );

    await recordAudit(client, {
      action: 'billing.export.created',
      result: 'success',
      actorAccountId: actor.kind === 'admin' ? actor.accountId : undefined,
      subjectId: exportId,
      organizationId: actor.scope.organizationId,
      franchiseId: actor.scope.franchiseId ?? cmd.franchiseId ?? undefined,
      correlationId,
      metadata: { from: cmd.from, to: cmd.to, billCount: workbook.summary.billCount },
    });

    await emitNotification(pool, {
      organizationId: actor.scope.organizationId,
      franchiseId: actor.scope.franchiseId ?? cmd.franchiseId ?? null,
      recipientRole: actor.scope.franchiseId ? 'franchise_owner' : 'central_admin',
      category: 'billing.retention',
      severity: 'info',
      title: 'Bill export ready',
      body: `${String(workbook.summary.billCount)} bills exported for ${cmd.from} to ${cmd.to}.`,
      entityType: 'retention_export',
      entityId: exportId,
      dedupKey: `retention_export:${exportId}`,
    });

    return { ...workbook, exportId, checksum };
  });
}

/** Flattens a workbook to a single CSV — one row per bill line, bill header
 *  columns repeated. The other sheets are available via the JSON export. */
export function workbookToCsv(book: BillsWorkbook): string {
  const header = [
    'receipt_number',
    'business_date',
    'outlet_name',
    'employee_name',
    'payment_method',
    'is_complimentary',
    'is_offline',
    'bill_subtotal',
    'bill_discount_total',
    'bill_round_adjustment',
    'bill_final_total',
    'line_no',
    'item_name',
    'quantity',
    'unit_price',
    'gst_rate',
    'line_base_total',
    'line_discount',
    'line_final_total',
    'note',
  ];
  const esc = (v: unknown): string => {
    let s: string;
    if (v === null || v === undefined) s = '';
    else if (typeof v === 'object') s = JSON.stringify(v);
    else if (typeof v === 'string') s = v;
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
    else s = '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const byBill = new Map<string, Record<string, unknown>[]>();
  for (const l of book.billItems) {
    const k = String(l.bill_id);
    const arr = byBill.get(k) ?? [];
    arr.push(l);
    byBill.set(k, arr);
  }
  const rows: string[] = [header.join(',')];
  for (const b of book.bills) {
    const lines = byBill.get(String(b.id)) ?? [{}];
    for (const l of lines) {
      rows.push(
        [
          b.receipt_number,
          b.business_date,
          b.outlet_name,
          b.employee_name,
          b.payment_method,
          b.is_complimentary,
          b.is_offline,
          b.subtotal,
          b.discount_total,
          b.round_adjustment,
          b.final_total,
          l.line_no,
          l.item_name,
          l.quantity,
          l.unit_price,
          l.gst_rate,
          l.base_total,
          l.discount,
          l.final_total,
          l.note,
        ]
          .map(esc)
          .join(','),
      );
    }
  }
  return rows.join('\n');
}
