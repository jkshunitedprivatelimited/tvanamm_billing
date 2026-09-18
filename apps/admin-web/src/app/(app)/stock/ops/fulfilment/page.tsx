import Link from 'next/link';
import { listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
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
  const [orders, warehouses, outlets] = await Promise.all([
    listOrdersForFulfilment(stockDb(), stockActor),
    listWarehouses(stockDb(), stockActor),
    listOutlets(db(), actor),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <p className="eyebrow">Supply · Dispatch desk</p>
      <h1>Outlet deliveries</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Review paid orders, choose a warehouse and prepare supplies for delivery.
      </p>
      <FulfilmentClient
        outlets={outlets.map((o) => ({ id: o.id, name: o.displayName }))}
        orders={orders}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
      />
    </main>
  );
}
