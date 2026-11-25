import { withStockActorContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';

export interface TransferWorkspace {
  stock: {
    locationId: string;
    itemId: string;
    itemName: string;
    unit: string;
    batchId: string | null;
    batchCode: string | null;
    available: string;
  }[];
  transfers: {
    id: string;
    number: string;
    status: string;
    fromName: string;
    toName: string;
    lines: {
      id: string;
      name: string;
      unit: string;
      batch: string | null;
      quantity: string;
      remaining: string;
    }[];
  }[];
}

export async function getTransferWorkspace(
  pool: StockPool,
  actor: StockActor,
): Promise<TransferWorkspace> {
  ensureStockAllowed(actor, 'stock.transfer.operate');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const stock = await client.query<TransferWorkspace['stock'][number]>(
      `select b.stock_location_id as "locationId", b.item_id as "itemId", i.name as "itemName",
        i.base_unit as unit, b.batch_id as "batchId", batch.batch_code as "batchCode", (b.on_hand-b.allocated)::text as available
       from stock.stock_balances b join stock.items i on i.id=b.item_id
       join stock.stock_locations l on l.id=b.stock_location_id
       join stock.warehouses w on w.id=l.warehouse_id
       left join stock.batches batch on batch.id=b.batch_id
       where b.organization_id=$1 and w.organization_id=$1 and w.is_active and l.kind='sellable'
         and b.on_hand>b.allocated and i.is_active
       order by i.name,batch.expiry_date nulls last`,
      [actor.organizationId],
    );
    const transfers = await client.query<Omit<TransferWorkspace['transfers'][number], 'lines'>>(
      `select t.id,t.transfer_number as number,t.status::text,fw.name as "fromName",tw.name as "toName"
       from stock.stock_transfers t
       join stock.stock_locations f on f.id=t.from_location_id join stock.warehouses fw on fw.id=f.warehouse_id
       join stock.stock_locations d on d.id=t.to_location_id join stock.warehouses tw on tw.id=d.warehouse_id
       where t.organization_id=$1 order by t.created_at desc limit 100`,
      [actor.organizationId],
    );
    const lines = await client.query<
      TransferWorkspace['transfers'][number]['lines'][number] & { transferId: string }
    >(
      `select l.id,l.stock_transfer_id as "transferId",i.name,i.base_unit as unit,b.batch_code as batch,
         l.qty_base::text as quantity,
         (l.dispatched_qty_base-l.received_qty_base-l.damaged_qty_base-l.shortage_qty_base)::text as remaining
       from stock.stock_transfer_lines l join stock.items i on i.id=l.item_id
       left join stock.batches b on b.id=l.batch_id where l.stock_transfer_id=any($1::uuid[]) order by i.name`,
      [transfers.rows.map((t) => t.id)],
    );
    return {
      stock: stock.rows,
      transfers: transfers.rows.map((t) => ({
        ...t,
        lines: lines.rows.filter((l) => l.transferId === t.id),
      })),
    };
  });
}
