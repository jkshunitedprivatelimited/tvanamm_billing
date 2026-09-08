import Link from 'next/link';
import { listSuppliers } from '@jksh/stock';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { SuppliersClient } from './suppliers-client';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const suppliers = await listSuppliers(stockDb(), stockActor);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Suppliers</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        A supplier must be approved before a purchase order can be raised against it.
      </p>
      <SuppliersClient rows={suppliers} />
    </main>
  );
}
