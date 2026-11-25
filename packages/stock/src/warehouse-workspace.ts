import { withStockActorContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
export interface WarehouseWork {
  production: {
    id: string;
    warehouseId: string;
    warehouse: string;
    item: string;
    unit: string;
    planned: string;
    produced: string;
    status: string;
  }[];
  returns: {
    id: string;
    warehouse: string;
    supplier: string;
    item: string;
    batch: string | null;
    quantity: string;
    unit: string;
    status: string;
    reason: string;
    resolution: string | null;
  }[];
}
export async function getWarehouseWork(pool: StockPool, actor: StockActor): Promise<WarehouseWork> {
  ensureStockAllowed(actor, 'stock.production.operate');
  ensureStockAllowed(actor, 'stock.supplier.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const production = await client.query<WarehouseWork['production'][number]>(
      `select p.id,p.warehouse_id as "warehouseId",w.name as warehouse,i.name as item,i.base_unit as unit,
      p.planned_qty_base::text as planned,p.produced_qty_base::text as produced,p.status::text
      from stock.production_orders p join stock.warehouses w on w.id=p.warehouse_id join stock.items i on i.id=p.output_item_id
      where p.organization_id=$1 order by p.created_at desc limit 100`,
      [actor.organizationId],
    );
    const returns = await client.query<WarehouseWork['returns'][number]>(
      `select r.id,w.name as warehouse,s.name as supplier,i.name as item,b.batch_code as batch,
      r.quantity_base::text as quantity,i.base_unit as unit,r.status::text,r.reason::text,r.resolution::text
      from stock.supplier_returns r join stock.warehouses w on w.id=r.warehouse_id join stock.suppliers s on s.id=r.supplier_id
      join stock.items i on i.id=r.item_id left join stock.batches b on b.id=r.batch_id
      where r.organization_id=$1 order by r.created_at desc limit 100`,
      [actor.organizationId],
    );
    return { production: production.rows, returns: returns.rows };
  });
}
