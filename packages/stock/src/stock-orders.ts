import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import {
  assertOutletInFranchise,
  ensureStockAllowed,
  stockContextForActor,
  type StockActor,
} from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { recordStockOutbox } from './events';
import { resolveRazorpayGateway, type RazorpayGateway } from './razorpay';

interface DeliveryRule {
  kind: 'flat' | 'per_outlet' | 'free_over_threshold' | 'free';
  amount_paise: string;
  free_over_paise: string | null;
  version: number;
}

/** Delivery charge for a rule given the pre-delivery order total, in paise. */
export function computeDeliveryPaise(
  rule: Pick<DeliveryRule, 'kind' | 'amount_paise' | 'free_over_paise'> | null,
  preDeliveryTotalPaise: number,
): number {
  if (!rule || rule.kind === 'free') return 0;
  if (rule.kind === 'free_over_threshold') {
    const threshold = Number(rule.free_over_paise ?? 0);
    return preDeliveryTotalPaise >= threshold ? 0 : Number(rule.amount_paise);
  }
  return Number(rule.amount_paise);
}

export interface StockOrderLineInput {
  supplyCatalogItemId: string;
  qtyBase: string;
}

export interface CreateStockOrderCommand {
  organizationId: string;
  outletId: string;
  franchiseId: string;
  orderNumber: string;
  lines: StockOrderLineInput[];
  suggestionId?: string | null;
}

export interface StockOrderTotals {
  id: string;
  subtotalPaise: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
}

/**
 * Create a draft stock order for exactly one outlet. Prices, GST, HSN and the
 * delivery rule are snapshotted from the published catalog server-side; the
 * client only supplies catalog item ids and quantities, so a tampered price has
 * nothing to tamper.
 */
export async function createStockOrder(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateStockOrderCommand,
): Promise<StockOrderTotals> {
  ensureStockAllowed(actor, 'stock.order.create');
  if (actor.request !== 'system' && actor.franchiseId !== cmd.franchiseId) {
    throw new StockError('forbidden', 'Cannot order for another franchise');
  }
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  if (cmd.lines.length === 0) throw new StockError('validation', 'An order needs a line');
  const seen = new Set<string>();
  for (const line of cmd.lines) {
    if (seen.has(line.supplyCatalogItemId)) {
      throw new StockError('validation', 'Duplicate catalog line');
    }
    seen.add(line.supplyCatalogItemId);
  }

  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    let subtotal = 0;
    let tax = 0;
    let deliveryRuleId: string | null = null;
    let deliveryRule: DeliveryRule | null = null;

    const priced: {
      catalogId: string;
      itemId: string;
      qty: string;
      unitPricePaise: number;
      gstRate: string;
      hsn: string | null;
    }[] = [];

    for (const line of cmd.lines) {
      const cat = await client.query<{
        item_id: string;
        gst_inclusive_price_paise: string;
        gst_rate: string;
        hsn_code: string | null;
        is_available: boolean;
        delivery_rule_id: string | null;
      }>(
        `select item_id, gst_inclusive_price_paise, gst_rate, hsn_code, is_available, delivery_rule_id
           from stock.supply_catalog_items
          where id = $1 and organization_id = $2`,
        [line.supplyCatalogItemId, cmd.organizationId],
      );
      const c = cat.rows[0];
      if (!c) throw new StockError('not_found', 'Catalog item not found');
      if (!c.is_available) throw new StockError('conflict', 'Catalog item is unavailable');
      const blocked = await client.query(
        `select 1 from stock.supply_catalog_outlet_blocks
          where supply_catalog_item_id = $1 and outlet_id = $2`,
        [line.supplyCatalogItemId, cmd.outletId],
      );
      if (blocked.rowCount)
        throw new StockError('conflict', 'Catalog item is blocked for this outlet');

      const qty = Number(line.qtyBase);
      const lineGstInclusive = Math.round(qty * Number(c.gst_inclusive_price_paise));
      const gst = Number(c.gst_rate);
      const lineTaxable = Math.round(lineGstInclusive / (1 + gst / 100));
      subtotal += lineTaxable;
      tax += lineGstInclusive - lineTaxable;

      if (!deliveryRuleId && c.delivery_rule_id) {
        deliveryRuleId = c.delivery_rule_id;
        const dr = await client.query<DeliveryRule>(
          'select kind, amount_paise, free_over_paise, version from stock.delivery_charge_rules where id = $1',
          [c.delivery_rule_id],
        );
        deliveryRule = dr.rows[0] ?? null;
      }
      priced.push({
        catalogId: line.supplyCatalogItemId,
        itemId: c.item_id,
        qty: line.qtyBase,
        unitPricePaise: Number(c.gst_inclusive_price_paise),
        gstRate: c.gst_rate,
        hsn: c.hsn_code,
      });
    }

    const delivery = computeDeliveryPaise(deliveryRule, subtotal + tax);
    const total = subtotal + tax + delivery;

    const ins = await client.query<{ id: string }>(
      `insert into stock.stock_orders
         (organization_id, outlet_id, franchise_id, order_number, subtotal_paise, tax_paise,
          delivery_paise, total_paise, delivery_rule_id, delivery_rule_version, suggestion_id,
          created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [
        cmd.organizationId,
        cmd.outletId,
        cmd.franchiseId,
        cmd.orderNumber,
        subtotal,
        tax,
        delivery,
        total,
        deliveryRuleId,
        deliveryRule?.version ?? null,
        cmd.suggestionId ?? null,
        actor.accountId ?? null,
      ],
    );
    const orderId = requireRow(ins, 'stock order').id;
    for (const p of priced) {
      await client.query(
        `insert into stock.stock_order_lines
           (stock_order_id, supply_catalog_item_id, item_id, qty_base, unit_price_paise, gst_rate, hsn_code)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, p.catalogId, p.itemId, p.qty, p.unitPricePaise, p.gstRate, p.hsn],
      );
    }
    await recordStockAudit(client, {
      action: 'stock_order.created',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      franchiseId: cmd.franchiseId,
      outletId: cmd.outletId,
      subjectType: 'stock_order',
      subjectId: orderId,
      data: { totalPaise: total, lineCount: cmd.lines.length },
    });
    return {
      id: orderId,
      subtotalPaise: subtotal,
      taxPaise: tax,
      deliveryPaise: delivery,
      totalPaise: total,
    };
  });
}

export interface SubmitForPaymentResult {
  razorpayOrderId: string;
  amountPaise: number;
  status: string;
}

/** Create the Razorpay order for the authoritative total. Idempotent. */
export async function submitStockOrderForPayment(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  gateway: RazorpayGateway = resolveRazorpayGateway(),
): Promise<SubmitForPaymentResult> {
  ensureStockAllowed(actor, 'stock.order.create');
  const existing = await withStockActorContext(
    pool,
    stockContextForActor(actor),
    async (client) => {
      const { rows } = await client.query<{
        razorpay_order_id: string | null;
        total_paise: string;
        status: string;
        organization_id: string;
        currency: string;
      }>(
        `select razorpay_order_id, total_paise, status, organization_id, currency
         from stock.stock_orders where id = $1`,
        [orderId],
      );
      return rows[0];
    },
  );
  if (!existing) throw new StockError('not_found', 'Stock order not found');
  if (existing.razorpay_order_id) {
    return {
      razorpayOrderId: existing.razorpay_order_id,
      amountPaise: Number(existing.total_paise),
      status: existing.status,
    };
  }
  if (!['draft', 'awaiting_payment'].includes(existing.status)) {
    throw new StockError('conflict', `Cannot start payment on a ${existing.status} order`);
  }

  const rzp = await gateway.createOrder({
    amountPaise: Number(existing.total_paise),
    currency: existing.currency,
    receipt: orderId,
  });

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query(
      `update stock.stock_orders
          set razorpay_order_id = $2, status = 'awaiting_payment'
        where id = $1 and razorpay_order_id is null`,
      [orderId, rzp.id],
    );
    await client.query(
      `insert into stock.stock_order_payments
         (organization_id, stock_order_id, razorpay_order_id, amount_paise, currency, status)
       values ($1,$2,$3,$4,$5,'created')
       on conflict (razorpay_payment_id) do nothing`,
      [existing.organization_id, orderId, rzp.id, Number(existing.total_paise), existing.currency],
    );
    return {
      razorpayOrderId: rzp.id,
      amountPaise: Number(existing.total_paise),
      status: 'awaiting_payment',
    };
  });
}

export interface CheckoutCallbackCommand {
  orderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Process the browser Checkout callback. The signature is verified server-side;
 * an invalid signature has no financial effect. A valid signature only advances
 * the order to payment_pending - capture is confirmed by reconciliation.
 */
export async function confirmCheckoutCallback(
  pool: StockPool,
  actor: StockActor,
  cmd: CheckoutCallbackCommand,
  gateway: RazorpayGateway = resolveRazorpayGateway(),
): Promise<{ status: string; signatureVerified: boolean }> {
  ensureStockAllowed(actor, 'stock.order.create');
  const order = await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{ razorpay_order_id: string | null; status: string }>(
      'select razorpay_order_id, status from stock.stock_orders where id = $1',
      [cmd.orderId],
    );
    return rows[0];
  });
  if (!order?.razorpay_order_id) throw new StockError('not_found', 'Order has no Razorpay order');

  const ok = gateway.verifyCheckoutSignature(
    order.razorpay_order_id,
    cmd.razorpayPaymentId,
    cmd.razorpaySignature,
  );
  if (!ok) {
    throw new StockError('signature_invalid', 'Razorpay checkout signature is invalid');
  }

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query(
      `update stock.stock_orders
          set razorpay_payment_id = coalesce(razorpay_payment_id, $2),
              status = case when status in ('awaiting_payment','payment_pending')
                            then 'payment_pending' else status end
        where id = $1`,
      [cmd.orderId, cmd.razorpayPaymentId],
    );
    await client.query(
      `update stock.stock_order_payments
          set razorpay_payment_id = $2, status = 'authorized', signature_verified = true
        where stock_order_id = $1 and razorpay_payment_id is null`,
      [cmd.orderId, cmd.razorpayPaymentId],
    );
    return { status: 'payment_pending', signatureVerified: true };
  });
}

/**
 * Reconcile a stock order against Razorpay's authoritative payment state. Only a
 * captured payment for the exact internal amount marks the order paid and
 * emits StockOrderPaid; dispatch stays database-blocked until then.
 */
export async function reconcileStockOrderPayment(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  gateway: RazorpayGateway = resolveRazorpayGateway(),
): Promise<{ status: string }> {
  if (
    actor.request !== 'system' &&
    !['central_admin', 'accountant', 'franchise_owner'].includes(actor.role)
  ) {
    throw new StockError('forbidden', 'Not permitted to reconcile payments');
  }
  const order = await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      total_paise: string;
      currency: string;
      status: string;
      organization_id: string;
      franchise_id: string;
      outlet_id: string;
    }>(
      `select razorpay_order_id, razorpay_payment_id, total_paise, currency, status,
              organization_id, franchise_id, outlet_id
         from stock.stock_orders where id = $1`,
      [orderId],
    );
    return rows[0];
  });
  if (!order) throw new StockError('not_found', 'Stock order not found');
  if (order.status === 'paid' || order.status === 'approved') return { status: order.status };
  if (!order.razorpay_payment_id)
    throw new StockError('payment_unverified', 'No payment to reconcile');

  const payment = await gateway.fetchPayment(order.razorpay_payment_id);
  const matches =
    payment.status === 'captured' &&
    payment.id === order.razorpay_payment_id &&
    payment.amount === Number(order.total_paise) &&
    payment.currency === order.currency &&
    payment.order_id === order.razorpay_order_id;

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    if (matches) {
      await client.query(
        `update stock.stock_orders
            set status = 'paid', captured_amount_paise = $2, paid_at = now()
          where id = $1 and status in ('payment_pending','awaiting_payment')`,
        [orderId, payment.amount],
      );
      await client.query(
        `update stock.stock_order_payments set status = 'captured'
          where stock_order_id = $1 and razorpay_payment_id = $2`,
        [orderId, order.razorpay_payment_id],
      );
      await recordStockOutbox(client, {
        aggregateType: 'stock_order',
        aggregateId: orderId,
        eventType: 'StockOrderPaid',
        payload: {
          stockOrderId: orderId,
          outletId: order.outlet_id,
          franchiseId: order.franchise_id,
          amountPaise: payment.amount,
        },
      });
      return { status: 'paid' };
    }
    if (payment.status === 'failed') {
      await client.query(
        `update stock.stock_orders set status = 'failed'
          where id = $1 and status in ('payment_pending','awaiting_payment')`,
        [orderId],
      );
      await client.query(
        `update stock.stock_order_payments set status = 'failed'
          where stock_order_id = $1 and razorpay_payment_id = $2`,
        [orderId, order.razorpay_payment_id],
      );
      return { status: 'failed' };
    }
    return { status: order.status };
  });
}

export interface RazorpayWebhookInput {
  eventId: string;
  eventType: string;
  rawBody: string;
  signature: string;
  payload: Record<string, unknown>;
}

/**
 * Ingest a Razorpay webhook: raw-body signature check, unique event id, fast
 * idempotent acknowledgement. A payment.captured event reconciles the matching
 * order.
 */
export async function handleRazorpayWebhook(
  pool: StockPool,
  input: RazorpayWebhookInput,
  gateway: RazorpayGateway = resolveRazorpayGateway(),
): Promise<{ duplicate: boolean; processed: boolean }> {
  const verified = gateway.verifyWebhookSignature(input.rawBody, input.signature);
  if (!verified) throw new StockError('signature_invalid', 'Razorpay webhook signature is invalid');

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const existing = await client.query<{ processed_at: string | null }>(
      'select processed_at from stock.razorpay_webhook_events where event_id = $1',
      [input.eventId],
    );
    if (existing.rows[0]) {
      return { duplicate: true, processed: existing.rows[0].processed_at != null };
    }
    await client.query(
      `insert into stock.razorpay_webhook_events (event_id, event_type, payload, signature_verified)
       values ($1,$2,$3,true)`,
      [input.eventId, input.eventType, JSON.stringify(input.payload)],
    );

    let processed = false;
    let note: string | null = null;
    if (input.eventType === 'payment.captured') {
      const rzpOrderId = extractOrderId(input.payload);
      if (rzpOrderId) {
        const order = await client.query<{
          id: string;
          total_paise: string;
          currency: string;
          razorpay_payment_id: string | null;
        }>(
          `select id, total_paise, currency, razorpay_payment_id
             from stock.stock_orders where razorpay_order_id = $1`,
          [rzpOrderId],
        );
        const row = order.rows[0];
        if (row) {
          const paymentId = extractPaymentId(input.payload);
          const amount = extractAmount(input.payload);
          const currency = extractCurrency(input.payload);
          // Never mark paid from an unverified webhook body: the payment id,
          // captured amount, and currency must all match the internal order.
          const reasons: string[] = [];
          if (!paymentId) reasons.push('missing payment id');
          if (row.razorpay_payment_id && paymentId && row.razorpay_payment_id !== paymentId) {
            reasons.push('payment id does not match the checkout callback');
          }
          if (amount !== Number(row.total_paise)) {
            reasons.push(`amount ${String(amount)} != ${row.total_paise}`);
          }
          if (currency !== row.currency) {
            reasons.push(`currency ${currency ?? '(none)'} != ${row.currency}`);
          }
          if (reasons.length > 0) {
            note = `rejected: ${reasons.join('; ')}`;
          } else {
            await client.query(
              `update stock.stock_orders
                  set razorpay_payment_id = coalesce(razorpay_payment_id, $2),
                      status = 'paid', captured_amount_paise = $3, paid_at = now()
                where id = $1 and status in ('awaiting_payment','payment_pending')`,
              [row.id, paymentId, amount],
            );
            await client.query(
              `update stock.stock_order_payments set status = 'captured', signature_verified = true
                where stock_order_id = $1
                  and (razorpay_payment_id = $2 or razorpay_payment_id is null)`,
              [row.id, paymentId],
            );
            processed = true;
          }
        }
      }
    }
    await client.query(
      'update stock.razorpay_webhook_events set processed_at = now(), process_note = $2 where event_id = $1',
      [input.eventId, note],
    );
    return { duplicate: false, processed };
  });
}

function payloadEntity(payload: Record<string, unknown>): Record<string, unknown> | null {
  const p = payload as {
    payload?: { payment?: { entity?: Record<string, unknown> } };
  };
  return p.payload?.payment?.entity ?? null;
}
function extractOrderId(payload: Record<string, unknown>): string | null {
  const e = payloadEntity(payload);
  return typeof e?.order_id === 'string' ? e.order_id : null;
}
function extractPaymentId(payload: Record<string, unknown>): string | null {
  const e = payloadEntity(payload);
  return typeof e?.id === 'string' ? e.id : null;
}
function extractAmount(payload: Record<string, unknown>): number | null {
  const e = payloadEntity(payload);
  return typeof e?.amount === 'number' ? e.amount : null;
}
function extractCurrency(payload: Record<string, unknown>): string | null {
  const e = payloadEntity(payload);
  return typeof e?.currency === 'string' ? e.currency : null;
}

export interface StockOrderView {
  id: string;
  orderNumber: string;
  status: string;
  subtotalPaise: number;
  taxPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  capturedAmountPaise: number | null;
  lines: {
    supplyCatalogItemId: string;
    itemId: string;
    qtyBase: string;
    unitPricePaise: number;
    allocatedQtyBase: string;
    dispatchedQtyBase: string;
    receivedQtyBase: string;
  }[];
}

export async function getStockOrder(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
): Promise<StockOrderView> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      order_number: string;
      status: string;
      subtotal_paise: string;
      tax_paise: string;
      delivery_paise: string;
      total_paise: string;
      captured_amount_paise: string | null;
    }>('select * from stock.stock_orders where id = $1', [orderId]);
    const o = rows[0];
    if (!o) throw new StockError('not_found', 'Stock order not found');
    const lines = await client.query<{
      supply_catalog_item_id: string;
      item_id: string;
      qty_base: string;
      unit_price_paise: string;
      allocated_qty_base: string;
      dispatched_qty_base: string;
      received_qty_base: string;
    }>(
      `select supply_catalog_item_id, item_id, qty_base, unit_price_paise,
              allocated_qty_base, dispatched_qty_base, received_qty_base
         from stock.stock_order_lines where stock_order_id = $1`,
      [orderId],
    );
    return {
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      subtotalPaise: Number(o.subtotal_paise),
      taxPaise: Number(o.tax_paise),
      deliveryPaise: Number(o.delivery_paise),
      totalPaise: Number(o.total_paise),
      capturedAmountPaise: o.captured_amount_paise == null ? null : Number(o.captured_amount_paise),
      lines: lines.rows.map((l) => ({
        supplyCatalogItemId: l.supply_catalog_item_id,
        itemId: l.item_id,
        qtyBase: l.qty_base,
        unitPricePaise: Number(l.unit_price_paise),
        allocatedQtyBase: l.allocated_qty_base,
        dispatchedQtyBase: l.dispatched_qty_base,
        receivedQtyBase: l.received_qty_base,
      })),
    };
  });
}
