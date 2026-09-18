import {
  getOperatorSummary,
  getOpenCashSession,
  outletBillingWindow,
  listOpenShifts,
  getPublishedMenu,
} from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { StartShift } from './start-shift';
import { OpenRegister } from './open-register';
import { PosClient } from './pos-client';

export default async function PosPage() {
  const actor = await requireOperator();
  const pool = db();

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

  const [me, window_, cashSession, shifts, menu] = await Promise.all([
    getOperatorSummary(pool, actor),
    outletBillingWindow(pool, actor, actor.outletId),
    getOpenCashSession(pool, actor, actor.outletId),
    listOpenShifts(pool, actor, actor.outletId),
    getPublishedMenu(pool, actor, actor.outletId),
  ]);
  const outletName = me?.outletName ?? 'Outlet';
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

  if (!cashSession) {
    return <OpenRegister outletName={outletName} />;
  }

  if (!shifts.some((shift) => shift.employeeId === actor.employeeId)) {
    return <StartShift outletName={outletName} employeeName={me?.employeeName ?? 'Employee'} />;
  }

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
    <PosClient
      menu={menu}
      employeeId={actor.employeeId ?? ''}
      employeeName={me?.employeeName ?? 'Employee'}
      outletName={outletName}
    />
  );
}
