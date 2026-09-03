import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { SessionControls } from './session-controls';

export default async function Home() {
  const actor = await requireOperator();

  const { rows } = await db().query<{ full_name: string; employee_code: string; display_name: string }>(
    `select se.full_name, se.employee_code, o.display_name
       from identity.store_employees se
       join billing.outlets o on o.id = se.outlet_id
      where se.id = $1`,
    [actor.employeeId],
  );
  const me = rows[0];

  return (
    <>
      <div className="statusbar">
        <span>
          <strong>{me?.display_name ?? 'Outlet'}</strong> · Online
        </span>
        <span className="muted">{me?.employee_code}</span>
      </div>
      <main className="pos">
        <h1>Signed in as {me?.full_name ?? 'operator'}</h1>
        <p className="muted">
          The billing workspace (cart, checkout, receipts) is built in Stage 3. This confirms the
          terminal, employee, and operator session are wired end to end.
        </p>
        <SessionControls />
      </main>
    </>
  );
}
