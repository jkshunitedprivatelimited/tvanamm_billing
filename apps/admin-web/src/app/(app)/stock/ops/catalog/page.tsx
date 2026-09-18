import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listItems, listSupplyCatalogForCentral } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { CatalogManager } from './catalog-manager';
export const dynamic = 'force-dynamic';
export default async function CatalogPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock');
  const stockActor = await stockActorFor(actor);
  const [items, catalog] = await Promise.all([
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 500 }),
    listSupplyCatalogForCentral(stockDb(), stockActor),
  ]);
  return (
    <main>
      <p>
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <p className="eyebrow">Central admin · Supplies</p>
      <h1>Items & supply catalogue</h1>
      <p className="page-intro">
        Maintain materials and packaging, then publish the prices and pack sizes owners can order.
        Saved orders keep their original prices.
      </p>
      <CatalogManager items={items} catalog={catalog} />
    </main>
  );
}
