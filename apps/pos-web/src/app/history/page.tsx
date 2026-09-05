import { getOperatorSummary } from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { HistoryClient } from './history-client';

export default async function HistoryPage() {
  const actor = await requireOperator();
  const me = await getOperatorSummary(db(), actor);

  return (
    <main className="pos">
      <div className="statusbar" style={{ margin: '-32px -20px 20px' }}>
        <span>
          <strong>{me?.outletName ?? 'Outlet'}</strong> · Today&apos;s bills
        </span>
        <a href="/pos">&larr; Back to billing</a>
      </div>
      <HistoryClient />
    </main>
  );
}
