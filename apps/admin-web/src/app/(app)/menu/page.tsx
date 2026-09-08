import { listMasterMenu, listOutlets } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { MenuManager } from './MenuManager';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';

export default async function MenuPage() {
  const actor = await requireAdminActor();
  const isCentral = actor.role === 'central_admin';

  const outlets = await listOutlets(db(), actor);
  const master = isCentral
    ? await listMasterMenu(db(), actor, TVANAMM_BRAND)
    : { categories: [], items: [], addonGroups: [] };

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
    </main>
  );
}
