import { getOperatorSummary, getOpenCashSession, listExpenses } from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { CloseRegister } from './close-client';

export default async function ClosePage() {
  const actor = await requireOperator();
  const pool = db();
  const me = await getOperatorSummary(pool, actor);
  const cashSession = actor.outletId ? await getOpenCashSession(pool, actor, actor.outletId) : null;

  const expenses = actor.outletId
    ? await listExpenses(pool, actor, { outletId: actor.outletId, currentEmployeeShiftOnly: true })
    : [];

  return (
    <main className="pos">
      <h1>{me?.outletName ?? 'Outlet'}</h1>
      <p className="muted">Signed in as {me?.employeeName ?? 'operator'}</p>
      <a href="/pos">&larr; Back to billing</a>
      <div className="panel" style={{ margin: '20px 0', width: 'auto' }}>
        <CloseRegister cashSession={cashSession} expenses={expenses} />
      </div>
      <div className="row" style={{ gap: 16, marginTop: 16 }}>
        <a href="/expenses" className="link-btn">
          Record an expense
        </a>
        <a href="/pos/printer" className="link-btn">
          Printer settings
        </a>
      </div>
    </main>
  );
}
