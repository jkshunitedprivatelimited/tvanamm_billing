import Link from 'next/link';
import { listMasterMenu } from '@jksh/identity';
import { db } from '@/server/pool';
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
  const [recipes, items, menu] = await Promise.all([
    listRecipes(stockDb(), stockActor),
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 1000 }),
    listMasterMenu(db(), actor, '01000000-0000-4000-8000-000000000010'),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Recipes & serving standards</h1>
      <p>
        <Link href="/stock/ops/sop/chef">Collect complete menu SOPs from your chef →</Link>
      </p>
      <p>
        <Link href="/ai">Draft a recipe or SOP with JKSH AI →</Link>
      </p>
      <p>
        <Link href="/stock/ops/sop">Review revised SOP & measurement gaps →</Link>
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        Set a measured serving standard for each menu item. Publish only when ingredient quantities
        and portions are ready for stock deduction.
      </p>
      {recipes.length === 0 ? (
        <div className="empty-workspace">
          <h2>No production recipes published yet</h2>
          <p>
            Your SOP review is available below. Test recipes have been archived. Complete the
            missing measurements before enabling automatic ingredient deductions.
          </p>
          <Link href="/stock/ops/sop">View SOP standards →</Link>
        </div>
      ) : null}
      <RecipesClient
        rows={recipes}
        menuItems={menu.items.map((i) => ({ id: i.id, name: i.name }))}
        addons={menu.addonGroups.flatMap((g) =>
          g.addons.map((a) => ({ id: a.id, name: `${g.name} · ${a.name}` })),
        )}
        items={items.map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit }))}
      />
    </main>
  );
}
