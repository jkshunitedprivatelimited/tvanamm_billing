import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listOutlets } from '@jksh/identity';
import { listLowStockItems } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';
import { StockAlerts } from './stock-alerts';

export default async function StockAlertsPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const outlet = (await listOutlets(db(), actor)).find((o) => o.id === outletId);
  if (!outlet) notFound();
  const stockActor = await stockActorFor(actor, { outletId });
  const items = await listLowStockItems(stockDb(), stockActor, outletId);
  return (
    <main>
      <p>
        <Link href={`/stock/${outletId}`}>← Stock overview</Link>
      </p>
      <p className="eyebrow">{outlet.displayName}</p>
      <h1>Current stock & alerts</h1>
      <p className="page-intro">
        Set a minimum quantity for each item to get an alert when your stock runs low.
      </p>
      <StockAlerts outletId={outletId} initialItems={items} />
    </main>
  );
}
