import { redirect } from 'next/navigation';
import {
  getWarehouseWork,
  getTransferWorkspace,
  listWarehouses,
  listItems,
  listSuppliers,
} from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { WarehouseWorkClient } from './warehouse-work-client';
export default async function WarehouseWorkPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const a = await stockActorFor(actor);
  const db = stockDb();
  const [work, stock, warehouses, items, suppliers] = await Promise.all([
    getWarehouseWork(db, a),
    getTransferWorkspace(db, a),
    listWarehouses(db, a),
    listItems(db, a, { organizationId: a.organizationId, limit: 1000 }),
    listSuppliers(db, a),
  ]);
  return (
    <main>
      <h1>Production &amp; supplier returns</h1>
      <p>
        Record actual warehouse work. Quantities use each item's base unit. Review every stock
        movement before confirming.
      </p>
      <WarehouseWorkClient
        work={work}
        stock={stock.stock}
        warehouses={warehouses}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.baseUnit }))}
        suppliers={suppliers.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
