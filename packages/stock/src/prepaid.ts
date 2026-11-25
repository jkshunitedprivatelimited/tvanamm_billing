import type { StockPoolClient } from '@jksh/db';
import type { StockActor } from './authorize';
import { StockError } from './errors';

/** Called inside the fulfilment transaction. Lock the order and captured record
 * so a concurrent payment change cannot race a stock movement. COD is not supported. */
export async function assertPrepaidOrder(
  client: StockPoolClient,
  actor: StockActor,
  orderId: string,
) {
  const { rows } = await client.query<{
    organization_id: string;
    outlet_id: string;
    franchise_id: string;
    status: string;
    total_paise: string;
    currency: string;
    captured_amount_paise: string | null;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
  }>('select * from stock.stock_orders where id=$1 for update', [orderId]);
  const order = rows[0];
  if (order?.organization_id !== actor.organizationId)
    throw new StockError('not_found', 'Stock order not found');
  if (
    !order.razorpay_order_id ||
    !order.razorpay_payment_id ||
    order.captured_amount_paise !== order.total_paise ||
    order.currency !== 'INR'
  )
    throw new StockError(
      'payment_unverified',
      'A verified full prepaid payment is required before fulfilment',
    );
  const payment = await client.query(
    `select id from stock.stock_order_payments where stock_order_id=$1 and organization_id=$2
     and razorpay_order_id=$3 and razorpay_payment_id=$4 and status='captured'
     and amount_paise=$5::bigint and currency=$6 for share`,
    [
      orderId,
      actor.organizationId,
      order.razorpay_order_id,
      order.razorpay_payment_id,
      order.total_paise,
      order.currency,
    ],
  );
  if (!payment.rowCount)
    throw new StockError(
      'payment_unverified',
      'The captured payment does not match this order. Reconcile payment before fulfilment.',
    );
  return order;
}
