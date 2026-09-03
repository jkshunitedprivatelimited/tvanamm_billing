import { redirect } from 'next/navigation';
import { listWorkspaceCards } from '@jksh/identity';
import { db } from '@/server/pool';
import { getAdminActor } from '@/server/auth';
import { WorkspacePicker } from './picker';

export default async function SelectWorkspacePage() {
  const { user, actor } = await getAdminActor();
  if (!user) redirect('/login');
  if (actor) redirect('/');

  const cards = await listWorkspaceCards(db(), user.id);
  return (
    <main>
      <h1>Choose a workspace</h1>
      <p className="muted">You have access to more than one workspace. Pick one to continue.</p>
      <WorkspacePicker cards={cards} />
    </main>
  );
}
