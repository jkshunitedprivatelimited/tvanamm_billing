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
  const stockActor = await stockActorFor(actor, { outletId });
  const d = await getOwnerDashboard(stockDb(), stockActor, outletId);

  return (
    <main>
      <p className="muted">
        <Link href="/stock">← Stock</Link>
      </p>
      <h1>Outlet stock overview</h1>
      <div className="card">
        <div className="grid">
          <Stat label="Stock value" value={rupees(d.stockValuePaise)} />
          <Stat label="Reorder suggestions" value={String(d.openSuggestions)} />
          <Stat label="Local-inward reviews" value={String(d.pendingLocalInwardReviews)} />
          <Stat label="Open discrepancies" value={String(d.openDiscrepancies)} />
          <Stat label="Expiry warnings" value={String(d.expiryWarnings)} />
          <Stat label="Open recalls" value={String(d.openRecalls)} />
          <Stat label="Negative balances" value={String(d.negativeBalanceItems)} />
          <Stat label="Negative-stock exceptions" value={String(d.openNegativeExceptions)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <Link href={`/stock/${outletId}/order`}>Order stock</Link>
        <Link href={`/stock/${outletId}/suggestions`}>Reorder suggestions</Link>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
