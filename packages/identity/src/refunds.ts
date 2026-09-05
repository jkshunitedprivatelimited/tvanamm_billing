import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, CreateRefundCommand, RefundView } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit, recordOutbox } from './audit';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import type { RequestMeta } from './admin-auth';

const OWNER_REFUND_WINDOW_DAYS = 60;

function toPaise(decimal: string): number {
  const [whole, frac = ''] = decimal.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
function fromPaise(paise: number): string {
  const abs = Math.max(Math.round(paise), 0);
  return `${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

interface BillLineRow {
  id: string;
  quantity: number;
  final_total: string;
}

interface RefundableLine {
  billLineId: string;
  originalQuantity: number;
  refundedQuantity: number;
  remainingQuantity: number;
  perUnitPaise: number;
}

async function loadRefundableLines(client: PoolClient, billId: string): Promise<RefundableLine[]> {
  // No FOR UPDATE here: loadBillForRefund's lock on the parent bill row
  // already serializes every concurrent refund attempt against this bill.
  const lines = await client.query<BillLineRow>(
    `select id, quantity, final_total from billing.bill_lines where bill_id = $1`,
    [billId],
  );
  const refunded = await client.query<{ bill_line_id: string; qty: string }>(
    `select bl.id as bill_line_id, coalesce(sum(rl.quantity), 0) as qty
       from billing.bill_lines bl
       left join billing.refund_lines rl on rl.bill_line_id = bl.id
      where bl.bill_id = $1
      group by bl.id`,
    [billId],
  );
  const refundedByLine = new Map(refunded.rows.map((r) => [r.bill_line_id, Number(r.qty)]));
  return lines.rows.map((l) => {
    const refundedQuantity = refundedByLine.get(l.id) ?? 0;
    return {
      billLineId: l.id,
      originalQuantity: l.quantity,
      refundedQuantity,
      remainingQuantity: l.quantity - refundedQuantity,
      perUnitPaise: Math.round(toPaise(l.final_total) / l.quantity),
    };
  });
}

interface BillRow {
  id: string;
  organization_id: string;
  franchise_id: string | null;
  outlet_id: string;
  final_total: string;
  business_date: string;
  committed_at: Date;
}

async function loadBillForRefund(client: PoolClient, billId: string): Promise<BillRow> {
  const { rows } = await client.query<BillRow>(
    `select id, organization_id, franchise_id, outlet_id, final_total,
            business_date::text as business_date, committed_at
       from billing.bills where id = $1 for update`,
    [billId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Bill not found');
  return rows[0];
}

async function refundedSoFar(client: PoolClient, billId: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `select coalesce(sum(amount), 0) as total from billing.refunds where bill_id = $1`,
    [billId],
  );
  return toPaise(rows[0]?.total ?? '0.00');
}

/** Store Employees may refund only a same-outlet, same-business-date bill.
 *  A Franchise Owner may refund an owned-outlet bill within its 60-day active
 *  window. Central Admin and Accountant have no refund capability at all
 *  (enforced by the role/capability grants, not special-cased here). */
async function assertRefundWindow(
  client: PoolClient,
  actor: ActorContext,
  bill: BillRow,
): Promise<void> {
  if (actor.kind === 'operator') {
    const { rows } = await client.query<{ timezone: string }>(
      `select timezone from billing.outlets where id = $1`,
      [bill.outlet_id],
    );
    const today = businessDateString(new Date(), rows[0]?.timezone ?? 'Asia/Kolkata');
    if (bill.business_date !== today) {
      throw new IdentityError(
        'conflict',
        'Only today’s bills can be refunded by a Store Employee',
        {
          details: { code: 'refund_window_expired' },
        },
      );
    }
    return;
  }
  const ageDays = (Date.now() - bill.committed_at.getTime()) / 86_400_000;
  if (ageDays > OWNER_REFUND_WINDOW_DAYS) {
    throw new IdentityError('conflict', 'This bill is outside the 60-day refund window', {
      details: { code: 'refund_window_expired' },
    });
  }
}

export async function createRefund(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateRefundCommand,
  meta: RequestMeta = {},
): Promise<RefundView> {
  const capability = cmd.kind === 'full' ? 'billing.refund.full' : 'billing.refund.partial';
  const correlationId = meta.correlationId ?? randomUUID();

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const bill = await loadBillForRefund(client, cmd.billId);

    const existing = await client.query<{ id: string }>(
      `select id from billing.refunds where outlet_id = $1 and idempotency_key = $2`,
      [bill.outlet_id, cmd.idempotencyKey],
    );
    if (existing.rows[0]) return loadRefund(client, existing.rows[0].id);

    ensureAllowed(actor, capability, {
      organizationId: bill.organization_id,
      ...(bill.franchise_id ? { franchiseId: bill.franchise_id } : {}),
      outletId: bill.outlet_id,
    });
    await assertRefundWindow(client, actor, bill);

    if (cmd.payoutMethod === 'upi' && !cmd.payoutReference?.trim()) {
      throw new IdentityError('validation', 'A UPI refund requires a payout reference');
    }

    const refundableLines = await loadRefundableLines(client, cmd.billId);
    const byId = new Map(refundableLines.map((l) => [l.billLineId, l]));

    const targets: { line: RefundableLine; quantity: number }[] = [];
    if (cmd.kind === 'full') {
      for (const l of refundableLines) {
        if (l.remainingQuantity > 0) targets.push({ line: l, quantity: l.remainingQuantity });
      }
    } else {
      const requested = cmd.lines ?? [];
      if (requested.length === 0) {
        throw new IdentityError('validation', 'A partial refund needs at least one line');
      }
      for (const r of requested) {
        const line = byId.get(r.billLineId);
        if (!line) throw new IdentityError('validation', 'Bill line not found on this bill');
        if (r.quantity > line.remainingQuantity) {
          throw new IdentityError('conflict', 'Refund quantity exceeds what remains on this line', {
            details: { code: 'refund_exceeds_remaining', billLineId: r.billLineId },
          });
        }
        targets.push({ line, quantity: r.quantity });
      }
    }
    if (targets.length === 0 || targets.every((t) => t.quantity === 0)) {
      throw new IdentityError('conflict', 'Nothing remains to refund on this bill', {
        details: { code: 'nothing_to_refund' },
      });
    }

    const lineAmounts = targets.map((t) => ({
      billLineId: t.line.billLineId,
      quantity: t.quantity,
      amountPaise: t.line.perUnitPaise * t.quantity,
    }));
    let totalPaise = lineAmounts.reduce((s, l) => s + l.amountPaise, 0);

    // A full refund pays back exactly what remains of the bill's own total
    // (including any Cash rounding adjustment); fold that last cent delta
    // into the final line so the lines always sum to the header amount.
    if (cmd.kind === 'full') {
      const remainingOnBill = toPaise(bill.final_total) - (await refundedSoFar(client, cmd.billId));
      const delta = remainingOnBill - totalPaise;
      const lastLine = lineAmounts.at(-1);
      if (delta !== 0 && lastLine) {
        lastLine.amountPaise += delta;
        totalPaise = remainingOnBill;
      }
    }

    const employeeId = actor.kind === 'operator' ? (actor.employeeId ?? null) : null;
    const actorName = await resolveActorName(client, actor);

    // A Cash payout draws down the currently open cash session, if any.
    const cash = await client.query<{ id: string }>(
      `select id from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
      [bill.outlet_id],
    );
    const cashSessionId = cmd.payoutMethod === 'cash' ? (cash.rows[0]?.id ?? null) : null;

    const refundId = randomUUID();
    try {
      await client.query(
        `insert into billing.refunds
           (id, organization_id, franchise_id, outlet_id, bill_id, kind, amount, payout_method,
            payout_reference, reason, actor_account_id, actor_employee_id, actor_name,
            cash_session_id, idempotency_key, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          refundId,
          bill.organization_id,
          bill.franchise_id,
          bill.outlet_id,
          cmd.billId,
          cmd.kind,
          fromPaise(totalPaise),
          cmd.payoutMethod,
          cmd.payoutMethod === 'upi' ? cmd.payoutReference : null,
          cmd.reason,
          actor.kind === 'admin' ? (actor.accountId ?? null) : null,
          employeeId,
          actorName,
          cashSessionId,
          cmd.idempotencyKey,
          correlationId,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const again = await client.query<{ id: string }>(
          `select id from billing.refunds where outlet_id = $1 and idempotency_key = $2`,
          [bill.outlet_id, cmd.idempotencyKey],
        );
        if (again.rows[0]) return loadRefund(client, again.rows[0].id);
      }
      throw err;
    }

    for (const l of lineAmounts) {
      await client.query(
        `insert into billing.refund_lines (refund_id, bill_line_id, quantity, amount)
         values ($1,$2,$3,$4)`,
        [refundId, l.billLineId, l.quantity, fromPaise(l.amountPaise)],
      );
    }

    await recordAudit(client, {
      action: 'sale.refunded',
      result: 'success',
      actorAccountId: actor.kind === 'admin' ? actor.accountId : undefined,
      actorEmployeeId: employeeId ?? undefined,
      subjectId: cmd.billId,
      organizationId: bill.organization_id,
      franchiseId: bill.franchise_id,
      outletId: bill.outlet_id,
      correlationId,
      metadata: { refundId, kind: cmd.kind, amount: fromPaise(totalPaise) },
    });
    await recordOutbox(client, {
      eventType: 'SaleRefunded',
      aggregateId: refundId,
      organizationId: bill.organization_id,
      franchiseId: bill.franchise_id,
      outletId: bill.outlet_id,
      correlationId,
      idempotencyKey: `SaleRefunded:${refundId}`,
      payload: {
        refundId,
        billId: cmd.billId,
        kind: cmd.kind,
        amount: fromPaise(totalPaise),
        lines: lineAmounts.map((l) => ({
          billLineId: l.billLineId,
          quantity: l.quantity,
          wastageClassification: 'customer_cancelled',
        })),
      },
    });

    return loadRefund(client, refundId);
  });
}

async function resolveActorName(client: PoolClient, actor: ActorContext): Promise<string> {
  if (actor.kind === 'operator' && actor.employeeId) {
    const { rows } = await client.query<{ full_name: string }>(
      `select full_name from identity.store_employees where id = $1`,
      [actor.employeeId],
    );
    return rows[0]?.full_name ?? 'Employee';
  }
  if (actor.accountId) {
    const { rows } = await client.query<{ display_name: string }>(
      `select display_name from identity.account_profiles where id = $1`,
      [actor.accountId],
    );
    return rows[0]?.display_name ?? 'Owner';
  }
  return 'Unknown';
}

async function loadRefund(client: PoolClient, refundId: string): Promise<RefundView> {
  const r = await client.query<{
    id: string;
    bill_id: string;
    kind: RefundView['kind'];
    amount: string;
    payout_method: RefundView['payoutMethod'];
    payout_reference: string | null;
    reason: string;
    actor_name: string;
    created_at: Date;
  }>(
    `select id, bill_id, kind, amount, payout_method, payout_reference, reason, actor_name, created_at
       from billing.refunds where id = $1`,
    [refundId],
  );
  const row = r.rows[0];
  if (!row) throw new IdentityError('not_found', 'Refund not found');
  const lines = await client.query<{ bill_line_id: string; quantity: number; amount: string }>(
    `select bill_line_id, quantity, amount from billing.refund_lines where refund_id = $1`,
    [refundId],
  );
  return {
    id: row.id,
    billId: row.bill_id,
    kind: row.kind,
    amount: row.amount,
    payoutMethod: row.payout_method,
    payoutReference: row.payout_reference,
    reason: row.reason,
    actorName: row.actor_name,
    createdAt: row.created_at.toISOString(),
    lines: lines.rows.map((l) => ({
      billLineId: l.bill_line_id,
      quantity: l.quantity,
      amount: l.amount,
    })),
  };
}

export async function listRefunds(
  pool: Pool,
  actor: ActorContext,
  billId: string,
): Promise<RefundView[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from billing.refunds where bill_id = $1 order by created_at`,
      [billId],
    );
    return Promise.all(rows.map((r) => loadRefund(client, r.id)));
  });
}
