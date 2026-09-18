import {
  getOperatorSummary,
  getOpenCashSession,
  listExpenses,
  listOutletStaff,
} from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { CloseRegister } from './close-client';

export default async function ClosePage() {
  const actor = await requireOperator();
  const pool = db();
  const [staff, me, cashSession, expenses] = await Promise.all([
    listOutletStaff(pool, actor),
    getOperatorSummary(pool, actor),
    actor.outletId ? getOpenCashSession(pool, actor, actor.outletId) : null,
    actor.outletId
      ? listExpenses(pool, actor, { outletId: actor.outletId, currentEmployeeShiftOnly: true })
      : [],
  ]);
  const otherStaff = staff.filter(
    (person) => !person.isCurrentCashier && (person.checkedIn || person.shiftOpen),
  );

  return (
    <main className="pos">
      <h1>{me?.outletName ?? 'Outlet'}</h1>
      <p className="muted">Signed in as {me?.employeeName ?? 'operator'}</p>
      <a href="/pos">&larr; Back to billing</a>
      <div className="panel" style={{ margin: '20px 0', width: 'auto' }}>
        <CloseRegister
          cashSession={cashSession}
          expenses={expenses}
          otherStaff={otherStaff.map((person) => person.name)}
        />
      </div>
    </main>
  );
}
