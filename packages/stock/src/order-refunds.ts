import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, type StockActor } from './authorize';
import { StockError } from './errors';
import { recordStockAudit } from './audit';
import { resolveRazorpayGateway, type RazorpayGateway, type RazorpayRefund } from './razorpay';

/**
 * Cancel a stock order and refund its prepayment (stock migration 0027).
 *
 * - Unpaid orders (draft / awaiting payment / failed / expired) are cancelled
 *   with no money movement. The owning Franchise Owner or Central may do it.
 * - Paid or approved orders with nothing allocated yet can be cancelled by
 *   Central only; the captured payment is refunded in full.
 *
 * The refund row is committed before Razorpay is called. A retry with the same
 * `submissionId` (or a new attempt after a failed refund) first asks Razorpay for
 * a refund already tagged with our row id, so money is never returned twice.
 */

export const cancelStockOrderSchema = z.object({
  submissionId: z.uuid(),
  reason: z.string().trim().min(1, 'Enter why the order is cancelled').max(500),
});

const UNPAID = ['draft', 'awaiting_payment', 'failed', 'expired'];
const REFUNDABLE = ['paid', 'approved'];

export interface CancelStockOrderResult {
  orderId: string;
  status: 'cancelled';
  refund: {
    id: string;
    status: 'requested' | 'pending' | 'processed' | 'failed';
    amountPaise: number;
    razorpayRefundId: string | null;
  } | null;
  duplicate: boolean;
}

interface OrderRow {
  id: string;
  organization_id: string;
  franchise_id: string;
  outlet_id: string;
  status: string;
  razorpay_payment_id: string | null;
  captured_amount_paise: string | null;
  currency: string;
  allocated: string;
}

interface RefundRow {
  id: string;
  stock_order_id: string;
  submission_id: string;
  razorpay_payment_id: string;
  razorpay_refund_id: string | null;
  amount_paise: string;
  status: 'requested' | 'pending' | 'processed' | 'failed';
}

function view(r: RefundRow) {
  return {
    id: r.id,
    status: r.status,
    amountPaise: Number(r.amount_paise),
    razorpayRefundId: r.razorpay_refund_id,
  };
}

export async function cancelStockOrder(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  input: unknown,
  gateway?: RazorpayGateway,
): Promise<CancelStockOrderResult> {
  const parsed = cancelStockOrderSchema.safeParse(input);
  if (!parsed.success)
    throw new StockError('validation', parsed.error.issues[0]?.message ?? 'Invalid request');
  const cmd = parsed.data;
  const central = actor.request === 'system' || actor.role === 'central_admin';
  if (!central) ensureStockAllowed(actor, 'stock.order.create');

  // Step 1 (one transaction): decide, cancel unpaid orders, or record the refund.
  const step = await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const prior = await client.query<RefundRow>(
      `select id, stock_order_id, submission_id, razorpay_payment_id, razorpay_refund_id,
              amount_paise::text, status
         from stock.stock_order_refunds where organization_id = $1 and submission_id = $2`,
      [actor.organizationId, cmd.submissionId],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].stock_order_id !== orderId)
        throw new StockError('conflict', 'This request was already used for another order');
      return { kind: 'refund' as const, refund: prior.rows[0], duplicate: true };
    }

    const o = await client.query<OrderRow>(
      `select o.id, o.organization_id, o.franchise_id, o.outlet_id, o.status::text,
              o.razorpay_payment_id, o.captured_amount_paise::text, o.currency,
              coalesce((select sum(l.allocated_qty_base) from stock.stock_order_lines l
                         where l.stock_order_id = o.id), 0)::text allocated
         from stock.stock_orders o where o.id = $1 for update of o`,
      [orderId],
    );
    const order = o.rows[0];
    if (!order) throw new StockError('not_found', 'Stock order not found');
    if (order.organization_id !== actor.organizationId)
      throw new StockError('not_found', 'Stock order not found');
    if (!central && order.franchise_id !== actor.franchiseId)
      throw new StockError('not_found', 'Stock order not found');

    // An already-cancelled order whose refund failed may be refunded again.
    const live = await client.query<RefundRow>(
      `select id, stock_order_id, submission_id, razorpay_payment_id, razorpay_refund_id,
              amount_paise::text, status
         from stock.stock_order_refunds where stock_order_id = $1 and status <> 'failed'`,
      [orderId],
    );
    if (live.rows[0]) return { kind: 'refund' as const, refund: live.rows[0], duplicate: true };

    if (order.status === 'cancelled' && !order.razorpay_payment_id)
      return { kind: 'done' as const, duplicate: true };

    if (UNPAID.includes(order.status)) {
      await client.query(
        `update stock.stock_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
          where id = $1`,
        [orderId, cmd.reason],
      );
      await recordStockAudit(client, {
        action: 'stock_order.cancelled',
        actorRequest: actor.request,
        accountId: actor.accountId,
        organizationId: order.organization_id,
        franchiseId: order.franchise_id,
        outletId: order.outlet_id,
        subjectType: 'stock_order',
        subjectId: orderId,
        data: { reason: cmd.reason, previousStatus: order.status },
      });
      return { kind: 'done' as const, duplicate: false };
    }
    if (order.status === 'payment_pending')
      throw new StockError(
        'conflict',
        'A payment is being confirmed for this order. Check the payment, then cancel.',
      );

    const refundable =
      REFUNDABLE.includes(order.status) ||
      (order.status === 'cancelled' && !!order.razorpay_payment_id);
    if (!refundable)
      throw new StockError(
        'conflict',
        `This order is ${order.status.replace(/_/g, ' ')} and can no longer be cancelled here`,
      );
    if (!central)
      throw new StockError('forbidden', 'Ask Central to cancel and refund a paid order');
    if (Number(order.allocated) > 0)
      throw new StockError(
        'conflict',
        'Stock is already set aside for this order. Release the allocation before cancelling.',
      );
    const amount = Number(order.captured_amount_paise ?? 0);
    if (!order.razorpay_payment_id || !(amount > 0))
      throw new StockError('conflict', 'No captured payment is recorded for this order');

    const refundId = randomUUID();
    const ins = await client.query<RefundRow>(
      `insert into stock.stock_order_refunds
         (id, organization_id, stock_order_id, submission_id, razorpay_payment_id, amount_paise,
          currency, reason, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, stock_order_id, submission_id, razorpay_payment_id, razorpay_refund_id,
                 amount_paise::text, status`,
      [
        refundId,
        order.organization_id,
        orderId,
        cmd.submissionId,
        order.razorpay_payment_id,
        amount,
        order.currency,
        cmd.reason,
        actor.accountId ?? null,
      ],
    );
    await client.query(
      `update stock.stock_orders set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
              cancel_reason = $2
        where id = $1`,
      [orderId, cmd.reason],
    );
    await recordStockAudit(client, {
      action: 'stock_order.refund_requested',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: order.organization_id,
      franchiseId: order.franchise_id,
      outletId: order.outlet_id,
      subjectType: 'stock_order',
      subjectId: orderId,
      data: { refundId, amountPaise: amount, reason: cmd.reason, previousStatus: order.status },
    });
    const row = ins.rows[0];
    if (!row) throw new StockError('conflict', 'Could not record the refund');
    return { kind: 'refund' as const, refund: row, duplicate: false };
  });

  if (step.kind === 'done')
    return { orderId, status: 'cancelled', refund: null, duplicate: step.duplicate };
  const refund = step.refund;
  if (refund.razorpay_refund_id || refund.status !== 'requested')
    return { orderId, status: 'cancelled', refund: view(refund), duplicate: true };

  // Step 2: ask Razorpay, reusing a refund it may already have for this row.
  const rzp = gateway ?? resolveRazorpayGateway();
  let created: RazorpayRefund;
  try {
    created =
      (await rzp.findRefund(refund.razorpay_payment_id, refund.id)) ??
      (await rzp.refundPayment({
        paymentId: refund.razorpay_payment_id,
        amountPaise: Number(refund.amount_paise),
        refundRef: refund.id,
      }));
  } catch {
    await withStockActorContext(pool, stockSystemContext(), (c) =>
      c.query(
        `update stock.stock_order_refunds set failure_note = 'Razorpay did not respond; retry'
          where id = $1 and status = 'requested'`,
        [refund.id],
      ),
    );
    throw new StockError(
      'conflict',
      'The order is cancelled but the refund could not be started. Retry the refund.',
    );
  }
  const saved = await applyRefundStatus(pool, refund.id, created);
  return { orderId, status: 'cancelled', refund: saved, duplicate: step.duplicate };
}

/** Record Razorpay's view of a refund (from the API call or a webhook). */
async function applyRefundStatus(pool: StockPool, refundId: string, r: RazorpayRefund) {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const up = await client.query<RefundRow>(
      `update stock.stock_order_refunds
          set razorpay_refund_id = coalesce(razorpay_refund_id, $2),
              status = case when status = 'processed' then status else $3 end,
              failure_note = case when $3 = 'failed' then 'Razorpay reported the refund failed'
                                  else null end
        where id = $1
        returning id, stock_order_id, submission_id, razorpay_payment_id, razorpay_refund_id,
                  amount_paise::text, status`,
      [refundId, r.id, r.status],
    );
    const row = up.rows[0];
    if (!row) throw new StockError('not_found', 'Refund not found');
    if (row.status === 'processed')
      await client.query(
        `update stock.stock_order_payments set status = 'refunded'
          where stock_order_id = $1 and razorpay_payment_id = $2`,
        [row.stock_order_id, row.razorpay_payment_id],
      );
    return view(row);
  });
}

function refundEntity(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload as { payload?: { refund?: { entity?: Record<string, unknown> } } };
  return p.payload?.refund?.entity ?? null;
}

/**
 * Settle a refund from a verified Razorpay `refund.*` webhook. Matches on the
 * Razorpay refund id or our id in the notes; returns a note when nothing
 * matched or the amount disagrees.
 */
export async function applyRefundWebhook(
  pool: StockPool,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ processed: boolean; note: string | null }> {
  const e = refundEntity(payload);
  if (!e || typeof e.id !== 'string') return { processed: false, note: 'no refund entity' };
  const notes = e.notes && typeof e.notes === 'object' && !Array.isArray(e.notes) ? e.notes : {};
  const ref = (notes as Record<string, unknown>).jksh_refund_id;
  const row = await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const r = await client.query<{ id: string; amount_paise: string }>(
      `select id, amount_paise::text from stock.stock_order_refunds
        where razorpay_refund_id = $1 or ($2::uuid is not null and id = $2::uuid)
        limit 1`,
      [e.id, typeof ref === 'string' && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null],
    );
    return r.rows[0];
  });
  if (!row) return { processed: false, note: 'refund not recognised' };
  if (typeof e.amount === 'number' && e.amount !== Number(row.amount_paise))
    return { processed: false, note: `refund amount ${String(e.amount)} != ${row.amount_paise}` };
  const status =
    eventType === 'refund.processed'
      ? 'processed'
      : eventType === 'refund.failed'
        ? 'failed'
        : 'pending';
  await applyRefundStatus(pool, row.id, {
    id: e.id,
    payment_id: typeof e.payment_id === 'string' ? e.payment_id : '',
    amount: Number(row.amount_paise),
    status,
    refundRef: row.id,
  });
  return { processed: true, note: null };
}

export interface StockOrderRefundView {
  id: string;
  status: string;
  amountPaise: number;
  razorpayRefundId: string | null;
  reason: string;
  failureNote: string | null;
  requestedAt: string;
}

export async function listStockOrderRefunds(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
): Promise<StockOrderRefundView[]> {
  if (
    actor.request !== 'system' &&
    !['central_admin', 'accountant', 'franchise_owner'].includes(actor.role)
  )
    throw new StockError('forbidden', 'Not permitted');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      amount_paise: string;
      razorpay_refund_id: string | null;
      reason: string;
      failure_note: string | null;
      requested_at: Date;
      franchise_id: string;
    }>(
      `select r.id, r.status, r.amount_paise::text, r.razorpay_refund_id, r.reason, r.failure_note,
              r.requested_at, o.franchise_id
         from stock.stock_order_refunds r join stock.stock_orders o on o.id = r.stock_order_id
        where r.stock_order_id = $1 and r.organization_id = $2
        order by r.requested_at desc`,
      [orderId, actor.organizationId],
    );
    return rows
      .filter((r) => actor.role !== 'franchise_owner' || r.franchise_id === actor.franchiseId)
      .map((r) => ({
        id: r.id,
        status: r.status,
        amountPaise: Number(r.amount_paise),
        razorpayRefundId: r.razorpay_refund_id,
        reason: r.reason,
        failureNote: r.failure_note,
        requestedAt: r.requested_at.toISOString(),
      }));
  });
}
