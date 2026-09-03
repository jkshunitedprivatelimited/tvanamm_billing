import { requireAdminActor } from '@/server/auth';

export default async function ReportsPage() {
  const actor = await requireAdminActor();
  return (
    <main>
      <h1>Reports</h1>
      <div className="card">
        <p className="muted">
          {actor.role === 'accountant'
            ? 'Financial reports, reconciliation, GST summaries, and exports arrive in Stage 6. Your access is read-only across every outlet; the only write path is the future append-only accounting adjustment.'
            : 'Reporting dashboards arrive in Stage 6.'}
        </p>
      </div>
    </main>
  );
}
