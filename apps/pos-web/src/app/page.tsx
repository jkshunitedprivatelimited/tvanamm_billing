import { requireStoreSession } from '@/server/auth';
import { db } from '@/server/pool';
import { SessionControls } from './session-controls';

export default async function Home() {
  const { actor } = await requireStoreSession();

  const { rows } = await db().query<{ full_name: string; employee_code: string; outlet_name: string }>(
    `select se.full_name, se.employee_code, o.name as outlet_name
       from identity.store_employees se
       join identity.outlets o on o.id = se.outlet_id
      where se.user_id = $1`,
    [actor.userId],
  );
  const me = rows[0];

  return (
    <>
      <div className="statusbar">
        <span>
          <strong>{me?.outlet_name ?? 'Outlet'}</strong> · Online
        </span>
        <span className="muted">{me?.employee_code}</span>
      </div>
      <main className="pos">
        <h1>Signed in as {me?.full_name ?? 'operator'}</h1>
        <p className="muted">
          The billing workspace (cart, checkout, receipts) is built in Stage 3. For now this
          confirms the terminal, employee, and session are wired end to end.
        </p>
        <SessionControls />
      </main>
    </>
  );
}
