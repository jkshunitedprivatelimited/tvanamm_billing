import { withTransaction } from '@jksh/db';
import { listUserSessions } from '@jksh/identity';
import { requireActor, readSession } from '@/server/auth';
import { db } from '@/server/pool';
import { SessionList } from './list';

export default async function SessionsPage() {
  const actor = await requireActor();
  const state = await readSession();
  const sessions = await withTransaction(db(), (client) =>
    listUserSessions(client, actor.userId, state?.sessionId ?? ''),
  );

  return (
    <main>
      <h1>Your sessions</h1>
      <p className="muted">Sign out a device you no longer use. Disabling an account ends all of its sessions.</p>
      <SessionList sessions={sessions} />
    </main>
  );
}
