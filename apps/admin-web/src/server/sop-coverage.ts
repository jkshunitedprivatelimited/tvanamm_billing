import 'server-only';
import type { ActorContext } from '@jksh/contracts';
import { withStockActorContext } from '@jksh/db';
import { stockContextForActor } from '@jksh/stock';
import { db } from './pool';
import { listChefCollections, readChefCollection } from './chef-sop';
import { stockActorFor, stockDb } from './stock';
import { buildCoverage, type CoverageCatalogItem, type CoverageModel } from './sop-coverage-model';

/** Central-only SOP → Stock coverage for the newest open chef workbook. */
export async function loadSopCoverage(
  actor: ActorContext,
): Promise<(CoverageModel & { collectionTitle: string }) | null> {
  const collections = await listChefCollections(actor);
  const current = collections.find((c) => !c.revoked_at) ?? collections[0];
  if (!current) return null;
  const collection = await readChefCollection({ actor, id: current.id });
  const stockActor = await stockActorFor(actor);
  const [stock, catalog] = await Promise.all([
    withStockActorContext(stockDb(), stockContextForActor(stockActor), async (c) => {
      const items = await c.query<{ name: string }>(
        'select name from stock.items where organization_id = $1 and is_active',
        [stockActor.organizationId],
      );
      const recipes = await c.query<{
        id: string;
        billing_menu_item_id: string | null;
        status: string;
        current_version: number;
      }>(
        `select id, billing_menu_item_id, status::text, current_version from stock.recipes
          where organization_id = $1 and kind = 'menu_item' and status <> 'archived'`,
        [stockActor.organizationId],
      );
      return { items: items.rows, recipes: recipes.rows };
    }),
    db().query<{
      id: string;
      name: string;
      owner_scope: 'master' | 'outlet';
      outlet_name: string | null;
      stock_recipe_id: string | null;
    }>(
      `select ci.id, ci.name, ci.owner_scope::text owner_scope, o.display_name outlet_name,
              ci.stock_recipe_id
         from billing.catalog_items ci
         left join billing.outlets o on o.id = ci.outlet_id
        where ci.organization_id = $1 and ci.status = 'active'`,
      [actor.scope.organizationId],
    ),
  ]);
  const catalogItems: CoverageCatalogItem[] = catalog.rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerScope: r.owner_scope,
    outletName: r.outlet_name,
    stockRecipeId: r.stock_recipe_id,
  }));
  return {
    collectionTitle: collection.title,
    ...buildCoverage({
      menu: collection.menu,
      entries: collection.entries,
      stockItemNames: stock.items.map((i) => i.name),
      recipes: stock.recipes.map((r) => ({
        id: r.id,
        billingMenuItemId: r.billing_menu_item_id,
        status: r.status,
        currentVersion: r.current_version,
      })),
      catalog: catalogItems,
    }),
  };
}
