import Link from 'next/link';
import { listOutlets } from '@jksh/identity';
import { getCentralOversight, getOwnerDashboard } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';
import { RelayTrigger } from './RelayTrigger';

export const dynamic = 'force-dynamic';

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

export default async function StockPortfolioPage() {
  const actor = await requireAdminActor();
  if (actor.role === 'accountant') {
    return (
      <main>
        <h1>Stock</h1>
        <div className="card">
          <p className="muted">
            Accountants have read-only valuation and reconciliation access; drill-downs arrive with
            the finance workspace.
          </p>
        </div>
      </main>
    );
  }

  const stockActor = await stockActorFor(actor);

  if (actor.role === 'central_admin') {
    const oversight = await getCentralOversight(stockDb(), stockActor, stockActor.organizationId);
    return (
      <main>
        <h1>Stock — Central oversight</h1>
        <div className="card">
          <div className="grid">
            <Stat label="Stock value" value={rupees(oversight.stockValuePaise)} />
            <Stat label="Outlets tracked" value={String(oversight.outletsTracked)} />
            <Stat
              label="Open negative-stock exceptions"
              value={String(oversight.openNegativeExceptions)}
            />
            <Stat label="Open anomaly flags" value={String(oversight.openAnomalyFlags)} />
            <Stat label="Wastage events (30d)" value={String(oversight.wastageEventsLast30)} />
            <Stat label="Open recalls" value={String(oversight.openRecalls)} />
          </div>
        </div>
        <RelayTrigger />
      </main>
    );
  }

  const outlets = await listOutlets(db(), actor);
  const cards = await Promise.all(
    outlets.map(async (o) => {
      try {
        const stockActorForOutlet = await stockActorFor(actor, { outletId: o.id });
        const dashboard = await getOwnerDashboard(stockDb(), stockActorForOutlet, o.id);
        return { outlet: o, dashboard };
      } catch {
        return {
          outlet: o,
          dashboard: null as Awaited<ReturnType<typeof getOwnerDashboard>> | null,
        };
      }
    }),
  );

  return (
    <main>
      <h1>Stock — your outlets</h1>
      <div className="grid">
        {cards.map(({ outlet, dashboard }) => (
          <div key={outlet.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{outlet.displayName}</strong>
              <span className="pill">{outlet.status}</span>
            </div>
            {dashboard ? (
              <div className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>
                Stock value {rupees(dashboard.stockValuePaise)}
                <br />
                {dashboard.openSuggestions} reorder suggestion(s) ·{' '}
                {dashboard.pendingLocalInwardReviews} local-inward review(s)
                <br />
                {dashboard.openDiscrepancies} open discrepancy(ies) · {dashboard.openRecalls}{' '}
                recall(s)
                {dashboard.negativeBalanceItems > 0 ? (
                  <>
                    <br />
                    <span className="error">
                      {dashboard.negativeBalanceItems} negative balance(s)
                    </span>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                Stock tracking not configured yet.
              </p>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
              <Link href={`/stock/${outlet.id}`}>Overview</Link>
              <Link href={`/stock/${outlet.id}/order`}>Order stock</Link>
              <Link href={`/stock/${outlet.id}/suggestions`}>Suggestions</Link>
            </div>
          </div>
        ))}
        {outlets.length === 0 ? <p className="muted">No outlets in scope.</p> : null}
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
