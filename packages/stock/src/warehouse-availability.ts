import type { StockPoolClient } from '@jksh/db';
import { StockError } from './errors';
/** Share the ledger's item lock before reading availability and posting a warehouse issue. */
export async function lockWarehouseItem(
  client: StockPoolClient,
  locationId: string,
  itemId: string,
) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
    `stock-start:${locationId}:${itemId}`,
  ]);
}
export async function assertWarehouseAvailable(
  client: StockPoolClient,
  locationId: string,
  itemId: string,
  batchId: string | null,
  quantity: string,
) {
  if (!/^\d+(\.\d{1,6})?$/.test(quantity) || Number(quantity) <= 0)
    throw new StockError('validation', 'Quantity must be positive');
  await lockWarehouseItem(client, locationId, itemId);
  const balance = await client.query(
    `select 1 from stock.stock_balances where stock_location_id=$1 and item_id=$2
    and batch_id is not distinct from $3::uuid and on_hand-allocated >= $4::numeric for update`,
    [locationId, itemId, batchId, quantity],
  );
  if (!balance.rowCount)
    throw new StockError(
      'insufficient_stock',
      'Not enough unallocated stock in the selected batch',
    );
}
