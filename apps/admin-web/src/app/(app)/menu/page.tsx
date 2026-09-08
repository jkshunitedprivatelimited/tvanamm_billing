import { listMasterMenu, listOutlets, type MasterMenuView } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { MenuManager } from './MenuManager';
import { CatalogExtras } from './CatalogExtras';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const EMPTY_MASTER: MasterMenuView = {
  categories: [],
  items: [],
  addonGroups: [],
  combos: [],
};

export default async function MenuPage() {
  const actor = await requireAdminActor();
  const isCentral = actor.role === 'central_admin';

  const outlets = await listOutlets(db(), actor);
  const master = isCentral ? await listMasterMenu(db(), actor, TVANAMM_BRAND) : EMPTY_MASTER;

  return (
    <main>
      <h1>Menu</h1>
      <p className="page-intro">
        {isCentral
          ? 'One common TVANAMM menu. Edit an item and hit Publish — the new version goes live at every outlet instantly. Outlet price overrides are kept unless you reset them.'
          : 'Set your outlet’s prices and availability, then publish. The new version is live on the terminal straight away.'}
      </p>
      <MenuManager
        role={actor.role}
        brandId={TVANAMM_BRAND}
        master={master}
        outlets={outlets.map((o) => ({ id: o.id, name: o.displayName, status: o.status }))}
      />
      {isCentral ? (
        <CatalogExtras
          brandId={TVANAMM_BRAND}
          addonGroups={master.addonGroups}
          combos={master.combos}
          items={master.items.map((i) => ({ id: i.id, name: i.name }))}
        />
      ) : null}
    </main>
  );
}
