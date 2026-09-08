import Link from 'next/link';
import { listItems, listRecipes } from '@jksh/stock';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { RecipesClient } from './recipes-client';

export const dynamic = 'force-dynamic';

export default async function RecipesPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const [recipes, items] = await Promise.all([
    listRecipes(stockDb(), stockActor),
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 1000 }),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Recipes</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        A published version is immutable. Billing lines resolve the recipe version that was live
        when the menu was published.
      </p>
      <RecipesClient rows={recipes} items={items.map((i) => ({ id: i.id, name: i.name }))} />
    </main>
  );
}
