import Link from 'next/link';
import {
  listItems,
  getOutletSellableLocation,
  listStockCountsForOutlet,
  listCountLines,
  listWastageForOutlet,
} from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { CountsWastageClient } from './counts-wastage-client';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = new Set(['open', 'counting', 'review']);

export default async function CountsWastagePage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const stockActor = await stockActorFor(actor, { outletId });

  const [items, location, counts, wastage] = await Promise.all([
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId }),
    getOutletSellableLocation(stockDb(), stockActor, outletId),
    listStockCountsForOutlet(stockDb(), stockActor, outletId),
    listWastageForOutlet(stockDb(), stockActor, outletId),
  ]);
  const activeCount = counts.find((c) => ACTIVE_STATUSES.has(c.status)) ?? null;
  const activeLines = activeCount
    ? await listCountLines(stockDb(), stockActor, activeCount.id)
    : [];

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <h1>Counts &amp; wastage</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Open a stock count when you want to verify what&rsquo;s physically on the shelf against the
        system, and record wastage (spoilage, breakage, prep loss) as it happens.
      </p>
      <CountsWastageClient
        role={actor.role}
        items={items}
        stockLocationId={location?.id ?? null}
        counts={counts}
        activeCount={activeCount}
        activeLines={activeLines}
        wastage={wastage}
      />
    </main>
  );
}
