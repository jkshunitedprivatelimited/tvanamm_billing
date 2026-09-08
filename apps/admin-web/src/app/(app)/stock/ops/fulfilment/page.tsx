import Link from 'next/link';
import { listOrdersForFulfilment, listWarehouses } from '@jksh/stock';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { FulfilmentClient } from './fulfilment-client';

export const dynamic = 'force-dynamic';

export default async function FulfilmentPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const [orders, warehouses] = await Promise.all([
    listOrdersForFulfilment(stockDb(), stockActor),
    listWarehouses(stockDb(), stockActor),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Fulfilment queue</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Paid outlet orders move through approve → allocate (FEFO hold at a warehouse) → dispatch
        (GST invoice from held rows).
      </p>
      <FulfilmentClient
        orders={orders}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
      />
    </main>
  );
}
