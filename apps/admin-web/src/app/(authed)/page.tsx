import Link from 'next/link';
import { requireActor } from '@/server/auth';
import { listOutletsForActor } from '@/server/queries';

export default async function DashboardPage() {
  const actor = await requireActor();

  if (actor.membership.role === 'accountant') {
    return (
      <main>
        <h1>Accountant workspace</h1>
        <div className="card">
          <p className="muted">
            Financial reports and exports arrive in Stage 6. Your access is read-only across
            authorized franchises and outlets.
          </p>
        </div>
      </main>
    );
  }

  const outlets = await listOutletsForActor(actor);

  return (
    <main>
      <h1>
        {actor.membership.role === 'central_admin' ? 'Central Admin' : 'Franchise Owner'} workspace
      </h1>
      <p className="muted">
        {actor.membership.role === 'central_admin'
          ? 'Every outlet in the organization.'
          : 'Your outlets. Select one to manage its terminal and employees.'}
      </p>

      <div className="grid">
        {outlets.map((outlet) => (
          <div key={outlet.id} className="card">
            <div style={{ fontWeight: 600 }}>{outlet.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {outlet.franchiseName}
              {outlet.address ? ` · ${outlet.address}` : ''}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
              <Link href={`/outlets/${outlet.id}/terminal`}>Terminal</Link>
              <Link href={`/outlets/${outlet.id}/employees`}>Employees</Link>
            </div>
          </div>
        ))}
        {outlets.length === 0 ? <p className="muted">No outlets in scope yet.</p> : null}
      </div>
    </main>
  );
}
