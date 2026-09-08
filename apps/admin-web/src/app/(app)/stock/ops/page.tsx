import Link from 'next/link';
import { requireAdminActor } from '@/server/auth';

export const dynamic = 'force-dynamic';

const SECTIONS = [
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
    href: '/stock/ops/recipes',
    title: 'Recipes',
    blurb: 'Author recipes, publish immutable versions, link to Billing.',
  },
  {
    href: '/stock/ops/fulfilment',
    title: 'Fulfilment queue',
    blurb: 'Approve, allocate and dispatch paid outlet orders.',
  },
  {
    href: '/stock/ops/recalls',
    title: 'Recalls',
    blurb: 'Draft, activate and close batch recalls.',
  },
];

export default async function StockOpsHubPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') {
    return (
      <main>
        <h1>Stock operations</h1>
        <div className="card">
          <p className="muted">This workspace is operated by Central.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Stock operations</h1>
      <p className="page-intro">
        Central-run warehouse and supply desk — master data, procurement, recipes, order fulfilment
        and recalls for every TVANAMM outlet.
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
