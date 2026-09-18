import { listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
import Link from 'next/link';
import { getOwnerDashboard } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';

export const dynamic = 'force-dynamic';

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

export default async function OutletStockOverview({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const outlets = await listOutlets(db(), actor);
  const outlet = outlets.find((o) => o.id === outletId);
  const stockActor = await stockActorFor(actor, { outletId });
  const d = await getOwnerDashboard(stockDb(), stockActor, outletId);

  return (
    <main>
      <p className="muted">
        <Link href={actor.role === 'franchise_owner' && outlets.length === 1 ? '/' : '/stock'}>
          {actor.role === 'franchise_owner' && outlets.length === 1
            ? '← Overview'
            : '← All outlet stock'}
        </Link>
      </p>
      <p className="eyebrow">{outlet?.displayName ?? 'Outlet'}</p>
      <h1>Stock overview</h1>
      <p className="page-intro">
        Order supplies, confirm deliveries and keep your stock records accurate.
      </p>
      <div className="card">
        <div className="grid">
          <Stat label="Stock value" value={rupees(d.stockValuePaise)} />
          <Stat label="Reorder suggestions" value={String(d.openSuggestions)} />
          <Stat
            label="Local purchases to review"
            value={String(d.pendingLocalInwardReviews)}
            href={`/stock/${outletId}/receiving`}
          />
          <Stat
            label="Delivery differences"
            value={String(d.openDiscrepancies)}
            href={`/stock/${outletId}/receiving`}
          />
          <Stat label="Expiry warnings" value={String(d.expiryWarnings)} />
          <Stat label="Open recalls" value={String(d.openRecalls)} />
          <Stat label="Items needing a stock check" value={String(d.negativeBalanceItems)} />
          <Stat label="Stock differences to review" value={String(d.openNegativeExceptions)} />
        </div>
      </div>
      <h2 className="section-label">Manage this outlet’s stock</h2>
      <div className="workflow-grid">
        {(
          [
            [
              'alerts',
              'Current stock & alerts',
              'See available quantities and set minimum levels for every stock item.',
            ],
            [
              'orders',
              'Orders & deliveries',
              'Follow orders, resume saved drafts and review delivery progress.',
            ],
            ['order', 'Order stock', 'Browse supplies, review your order and pay securely.'],
            [
              'receiving',
              'Receive deliveries',
              'Confirm what arrived and report missing or damaged items.',
            ],
            [
              'suggestions',
              'Plan replenishment',
              'Review suggested quantities before placing an order.',
            ],
            [
              'counts-wastage',
              'Counts & wastage',
              'Record physical counts and material that cannot be used.',
            ],
            ['returns', 'Return stock', 'Request a return and follow its progress.'],
          ] as const
        ).map(([path, title, description]) => (
          <Link className="workflow-card" key={path} href={`/stock/${outletId}/${path}`}>
            <strong>
              {title}
              <span aria-hidden="true"> →</span>
            </strong>
            <span>{description}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </>
  );
  return href ? (
    <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}
