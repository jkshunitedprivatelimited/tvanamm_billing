import { getOperatorSummary } from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { SessionControls } from './session-controls';

export default async function Home() {
  const actor = await requireOperator();
  const me = await getOperatorSummary(db(), actor);

  return (
    <>
      <div className="statusbar">
        <span>
          <strong>{me?.outletName ?? 'Outlet'}</strong> · Online
        </span>
        <span className="muted">{me?.employeeCode}</span>
      </div>
      <main className="pos">
        <h1>Signed in as {me?.employeeName ?? 'operator'}</h1>
        <p className="muted">
          The billing workspace (cart, checkout, receipts) is built in Stage 3. This confirms the
          terminal, employee, and operator session are wired end to end.
        </p>
        <SessionControls />
      </main>
    </>
  );
}
