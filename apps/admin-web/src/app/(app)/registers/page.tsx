import { redirect } from 'next/navigation';
import { listOwnerRegisters } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { Registers } from './registers';

export default async function RegistersPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'franchise_owner') redirect('/reports?category=cash');
  const registers = await listOwnerRegisters(db(), actor);
  return (
    <main className="container">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Register control</h1>
          <p className="muted">Review outlet cash and authorize register closure directly.</p>
        </div>
        <a href="/reports?category=cash">Closing history →</a>
      </div>
      <Registers initial={registers} />
    </main>
  );
}
