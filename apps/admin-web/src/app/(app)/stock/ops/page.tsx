import Link from 'next/link';
import { requireAdminActor } from '@/server/auth';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  {
    href: '/stock/ops/sop',
    title: 'SOP review & measurements',
    blurb: 'Review revised serving standards and resolve measurement gaps by category.',
  },
  {
    href: '/stock/ops/catalog',
    title: 'Items & supply catalogue',
    blurb: 'Manage materials, packaging, order packs and owner prices.',
  },
  {
    href: '/stock/ops/warehouses',
    title: 'Warehouses',
    blurb: 'Warehouses and their stock locations.',
  },
  {
    href: '/stock/ops/suppliers',
    title: 'Suppliers',
    blurb: 'Onboard and approve suppliers before purchasing.',
  },
  {
    href: '/stock/ops/purchase-orders',
    title: 'Purchase orders',
    blurb: 'Order supplies from vendors and record deliveries into stock.',
  },
  {
    href: '/stock/ops/recipes',
    title: 'Recipes',
    blurb: 'Set ingredient quantities and serving sizes for accurate stock use.',
  },
  {
    href: '/stock/ops/fulfilment',
    title: 'Outlet deliveries',
    blurb: 'Approve, allocate and dispatch paid outlet orders.',
  },
  {
    href: '/stock/ops/recalls',
    title: 'Recalls',
    blurb: 'Draft, activate and close batch recalls.',
  },
  {
    href: '/stock/ops/integration',
    title: 'Billing integration',
    blurb: 'Check that completed sales update stock and review failed updates.',
  },
];

export default async function StockOpsHubPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') {
    return (
      <main>
        <h1>Supply operations</h1>
        <div className="card">
          <p className="muted">This workspace is operated by Central.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Supply operations</h1>
      <p className="page-intro">
        Manage supplies, purchases, outlet deliveries and recipe standards across your outlets.
      </p>
      <div className="grid">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="card interactive">
            <strong>{s.title}</strong>
            <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>
              {s.blurb}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
