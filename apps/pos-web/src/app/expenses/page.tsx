import { getOperatorSummary } from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { ExpensesClient } from './expenses-client';

export default async function ExpensesPage() {
  const actor = await requireOperator();
  const me = await getOperatorSummary(db(), actor);

  return (
    <main className="pos">
      <div className="statusbar" style={{ margin: '-32px -20px 20px' }}>
        <span>
          <strong>{me?.outletName ?? 'Outlet'}</strong> · Record expense
        </span>
        <a href="/close">&larr; Back</a>
      </div>
      <ExpensesClient />
    </main>
  );
}
