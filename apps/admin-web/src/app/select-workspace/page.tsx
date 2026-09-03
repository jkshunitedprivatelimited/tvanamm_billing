import { redirect } from 'next/navigation';
import { listWorkspaceCards } from '@jksh/identity';
import { db } from '@/server/pool';
import { readSession } from '@/server/auth';
import { WorkspacePicker } from './picker';

export default async function SelectWorkspacePage() {
  const session = await readSession();
  if (!session) redirect('/login');
  if (session.actor) redirect('/');

  const cards = await listWorkspaceCards(db(), session.userId);
  return (
    <main>
      <h1>Choose a workspace</h1>
      <p className="muted">You have access to more than one workspace. Pick one to continue.</p>
      <WorkspacePicker cards={cards} />
    </main>
  );
}
