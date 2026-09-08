import Link from 'next/link';
import { listWarehouses } from '@jksh/stock';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { WarehousesClient } from './warehouses-client';

export const dynamic = 'force-dynamic';

export default async function WarehousesPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const warehouses = await listWarehouses(stockDb(), stockActor);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Warehouses</h1>
      <WarehousesClient rows={warehouses} />
    </main>
  );
}
