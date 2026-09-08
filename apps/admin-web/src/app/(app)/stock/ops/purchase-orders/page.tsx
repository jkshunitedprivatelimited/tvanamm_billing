import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listItems, listPurchaseOrders, listSuppliers, listWarehouses } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { PurchaseOrdersClient } from './purchase-orders-client';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const s = await stockActorFor(actor);
  const [pos, suppliers, warehouses, items] = await Promise.all([
    listPurchaseOrders(stockDb(), s, { limit: 100 }),
    listSuppliers(stockDb(), s),
    listWarehouses(stockDb(), s),
    listItems(stockDb(), s, { organizationId: s.organizationId, limit: 1000 }),
  ]);
  const supplierName = new Map(suppliers.map((x) => [x.id, x.name]));

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Purchase orders</h1>
      <p className="page-intro">
        Raise a PO against an approved supplier, walk it draft → submitted → approved → ordered,
        then record the shipment as it arrives (batches, expiry, accepted / damaged / rejected
        quantities).
      </p>
      <PurchaseOrdersClient
        pos={pos.map((p) => ({
          ...p,
          supplierName: supplierName.get(p.supplierId) ?? p.supplierId,
        }))}
        suppliers={suppliers
          .filter((x) => x.isApproved && x.isActive)
          .map((x) => ({ id: x.id, name: x.name }))}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        items={items.map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit }))}
      />
    </main>
  );
}
