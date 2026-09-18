import Link from 'next/link';
import { listItems, listReorderSuggestions } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { SuggestionsClient } from './suggestions-client';

export const dynamic = 'force-dynamic';

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const stockActor = await stockActorFor(actor, { outletId });

  const [suggestions, items] = await Promise.all([
    listReorderSuggestions(stockDb(), stockActor, outletId),
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 500 }),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.name]));

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <h1>Reorder suggestions</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Explainable, demand-based suggestions. There is no manual min/max and nothing is ordered
        automatically — you edit, dismiss, or convert a suggestion into a draft order.
      </p>
      <SuggestionsClient
        outletId={outletId}
        rows={suggestions.map((s) => ({
          id: s.id,
          itemId: s.itemId,
          itemName: itemName.get(s.itemId) ?? s.itemId,
          suggestedQtyBase: s.suggestedQtyBase,
          status: s.status,
          inputs: s.inputs,
        }))}
      />
    </main>
  );
}
