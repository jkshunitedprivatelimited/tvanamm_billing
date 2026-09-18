import {
  listMasterMenu,
  listOutletMenuForPricing,
  listOutlets,
  type MasterMenuView,
} from '@jksh/identity';
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

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string }>;
}) {
  const actor = await requireAdminActor();
  const isCentral = actor.role === 'central_admin';

  const outlets = await listOutlets(db(), actor);

  let master: MasterMenuView;
  let ownerOutletId = '';
  const firstOutlet = outlets[0];
  if (isCentral) {
    master = await listMasterMenu(db(), actor, TVANAMM_BRAND);
  } else if (!firstOutlet) {
    master = EMPTY_MASTER;
  } else {
    const requested = (await searchParams).outlet;
    const match = outlets.find((o) => o.id === requested);
    ownerOutletId = (match ?? firstOutlet).id;
    const pricing = await listOutletMenuForPricing(db(), actor, ownerOutletId);
    master = {
      categories: pricing.categories,
      items: pricing.items.map((it) => ({
        id: it.catalogItemId,
        ownerScope: it.ownerScope,
        name: it.name,
        categoryId: it.categoryId,
        price: it.outletPrice ?? it.masterPrice,
        gstRate: it.outletGstRate ?? it.masterGstRate,
        isAvailable: it.outletIsAvailable ?? it.masterIsAvailable,
        addonGroupIds: [],
        referencePrice: it.masterPrice,
      })),
      addonGroups: [],
      combos: [],
    };
  }

  return (
    <main>
      <h1>Menu</h1>
      <p className="page-intro">
        {isCentral
          ? 'One common TVANAMM menu. Edit an item and hit Publish — the new version goes live at every outlet instantly. Outlet price overrides are kept unless you reset them.'
          : outlets.length === 0
            ? 'No outlets assigned yet — menu pricing appears once an outlet is set up for you.'
            : 'Edit names, categories, prices and availability for this outlet. Remove items from sale or restore them, then publish to update billing. Other outlets and the central master menu are unchanged.'}
      </p>
      <MenuManager
        key={ownerOutletId || 'master'}
        role={actor.role}
        brandId={TVANAMM_BRAND}
        master={master}
        outlets={outlets.map((o) => ({ id: o.id, name: o.displayName, status: o.status }))}
        initialOwnerOutletId={ownerOutletId}
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
