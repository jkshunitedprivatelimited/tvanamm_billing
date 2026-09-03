import Link from 'next/link';
import { listFranchises, listOutlets } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { NewOutletForm } from './NewOutletForm';
import { FranchisePanel } from './FranchisePanel';

export default async function OutletsPage() {
  const actor = await requireAdminActor();

  if (actor.role === 'accountant') {
    return (
      <main>
        <h1>Accountant workspace</h1>
        <div className="card">
          <p className="muted">
            Financial reports, reconciliation, and adjustments arrive in Stage 6. Your access is
            read-only across every outlet.
          </p>
        </div>
      </main>
    );
  }

  const canCreate = actor.role === 'central_admin';
  const [outlets, franchises] = await Promise.all([
    listOutlets(db(), actor),
    canCreate ? listFranchises(db(), actor) : Promise.resolve([]),
  ]);

  return (
    <main>
      <h1>{canCreate ? 'Central Admin' : 'Your outlets'}</h1>

      {canCreate ? <FranchisePanel franchises={franchises} /> : null}
      {canCreate ? <NewOutletForm franchises={franchises} /> : null}

      <h2 style={{ marginTop: 24 }}>Outlets</h2>
      <div className="grid">
        {outlets.map((o) => (
          <div key={o.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{o.displayName}</strong>
              <span className="pill">{o.status}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {o.brandName} ·{' '}
              {o.ownershipType === 'jksh_owned' ? 'JKSH-owned' : (o.franchiseName ?? 'franchise')}
              {o.city ? ` · ${o.city}` : ''}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {o.hasActiveTerminal ? 'Terminal registered' : 'No terminal'}
              {o.gstin ? ` · GSTIN ${o.gstin}` : ''}
            </div>
            <div style={{ marginTop: 12 }}>
              <Link href={`/outlets/${o.id}`}>Manage</Link>
            </div>
          </div>
        ))}
        {outlets.length === 0 ? <p className="muted">No outlets in scope yet.</p> : null}
      </div>
    </main>
  );
}
