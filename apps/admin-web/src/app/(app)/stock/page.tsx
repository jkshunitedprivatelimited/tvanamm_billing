import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listOutlets } from '@jksh/identity';
import { getCentralOversight, getOwnerDashboard, listCentralLowStockAlerts } from '@jksh/stock';
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

  if (actor.role === 'franchise_owner') {
    const owned = await listOutlets(db(), actor);
    if (owned.length === 1 && owned[0]) redirect(`/stock/${owned[0].id}`);
  }
  const stockActor = await stockActorFor(actor);

  if (actor.role === 'central_admin') {
    const [oversight, alerts, outlets] = await Promise.all([
      getCentralOversight(stockDb(), stockActor, stockActor.organizationId),
      listCentralLowStockAlerts(stockDb(), stockActor),
      listOutlets(db(), actor),
    ]);
    return (
      <main>
        <p className="eyebrow">Central admin · Operations</p>
        <h1>Stock control</h1>
        <p className="page-intro">
          Monitor outlet shortages, coordinate replenishment and resolve stock issues.
        </p>
        <div className="workflow-grid" style={{ marginBottom: 24 }}>
          <Link className="workflow-card" href="/stock/ops/fulfilment">
            <strong>Fulfil outlet orders →</strong>
            <span>Review payments, allocate stock and prepare dispatches.</span>
          </Link>
          <Link className="workflow-card" href="/stock/ops/purchase-orders">
            <strong>Purchase supplies →</strong>
            <span>Manage supplier orders and incoming materials.</span>
          </Link>
          <Link className="workflow-card" href="/stock/ops/recalls">
            <strong>Manage recalls →</strong>
            <span>Contain stock risks and coordinate affected outlets.</span>
          </Link>
        </div>
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
        <h2>Outlets needing stock</h2>
        <p className="page-intro">
          Latest background checks · up to 100 active alerts. Open an outlet for current balances
          and limits.
        </p>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Item</th>
                <th>Available at check</th>
                <th>Limit</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={`${a.outletId}:${a.itemId}`}>
                  <td>{outlets.find((o) => o.id === a.outletId)?.displayName ?? 'Outlet'}</td>
                  <td>{a.name}</td>
                  <td>
                    {Number(a.quantity).toLocaleString('en-IN')} {a.baseUnit}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {new Date(a.checkedAt).toLocaleString()}
                    </div>
                  </td>
                  <td>
                    {Number(a.threshold).toLocaleString('en-IN')} {a.baseUnit}
                  </td>
                  <td>
                    <Link href={`/stock/${a.outletId}/alerts`}>Review shortage →</Link>
                  </td>
                </tr>
              ))}
              {!alerts.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No active alerts from completed checks. Configure outlet limits below to start
                    monitoring.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <h2>Outlet stock limits</h2>
        <div className="grid">
          {outlets.map((o) => (
            <Link className="workflow-card" key={o.id} href={`/stock/${o.id}/alerts`}>
              <strong>{o.displayName} →</strong>
              <span>Review balances and configure item thresholds.</span>
            </Link>
          ))}
        </div>
        <details style={{ marginTop: 24 }}>
          <summary>Integration tools</summary>
          <RelayTrigger />
        </details>
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
      <h1>Stock & orders</h1>
      <p className="page-intro">
        Choose an outlet to order supplies, receive deliveries or review stock that needs attention.
      </p>
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
                Stock data is unavailable. Open the outlet to check access or setup.
              </p>
            )}
            <div className="outlet-actions">
              <Link href={`/stock/${outlet.id}`}>Overview</Link>
              <Link href={`/stock/${outlet.id}/order`}>Order stock</Link>
              <Link href={`/stock/${outlet.id}/alerts`}>Stock limits</Link>
              <Link href={`/stock/${outlet.id}/suggestions`}>Reorder suggestions</Link>
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
