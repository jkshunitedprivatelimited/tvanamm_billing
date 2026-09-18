import Link from 'next/link';
import { listItems, listOwnerReturns } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { ReturnsClient } from './returns-client';

export const dynamic = 'force-dynamic';

export default async function ReturnsPage({ params }: { params: Promise<{ outletId: string }> }) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const stockActor = await stockActorFor(actor, { outletId });

  const [items, returns] = await Promise.all([
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId }),
    listOwnerReturns(stockDb(), stockActor, outletId),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <h1>Returns</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Request to send back JKSH stock already in your inventory — wrong item, excess, or a defect
        found after the fact. It stays on your on-hand stock until JKSH actually collects it, so
        keep it aside once approved.
      </p>
      <ReturnsClient outletId={outletId} role={actor.role} items={items} returns={returns} />
    </main>
  );
}
