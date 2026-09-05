import {
  getOperatorSummary,
  getOpenCashSession,
  outletBillingWindow,
  startShift,
  getPublishedMenu,
} from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { OpenRegister } from './open-register';
import { PosClient } from './pos-client';

export default async function PosPage() {
  const actor = await requireOperator();
  const pool = db();
  const me = await getOperatorSummary(pool, actor);
  const outletName = me?.outletName ?? 'Outlet';

  if (!actor.outletId) {
    return (
      <div className="screen">
        <div className="panel">
          <h1>No outlet</h1>
          <p className="muted">This session has no active outlet.</p>
        </div>
      </div>
    );
  }

  const window_ = await outletBillingWindow(pool, actor, actor.outletId);
  if (window_.blocked) {
    return (
      <div className="screen">
        <div className="panel">
          <h1>Billing paused</h1>
          <p className="muted">
            {window_.reason === 'stale_cash_session'
              ? 'A Cash session from a previous business day is still open. Ask your manager to close it before billing resumes.'
              : 'A shift from a previous business day is still open. Ask your manager to close it before billing resumes.'}
          </p>
        </div>
      </div>
    );
  }

  const cashSession = await getOpenCashSession(pool, actor, actor.outletId);
  if (!cashSession) {
    return <OpenRegister outletName={outletName} />;
  }

  // Resuming/starting the employee's own shift is automatic - it never
  // creates a second open shift for the same employee (`pos-workflow.md`
  // "Employee confirms/resumes their Billing shift").
  await startShift(pool, actor, {});

  const menu = await getPublishedMenu(pool, actor, actor.outletId);
  if (!menu) {
    return (
      <div className="screen">
        <div className="panel">
          <h1>No menu published</h1>
          <p className="muted">This outlet has no published menu yet.</p>
        </div>
      </div>
    );
  }

  return (
    <PosClient menu={menu} employeeName={me?.employeeName ?? 'Employee'} outletName={outletName} />
  );
}
