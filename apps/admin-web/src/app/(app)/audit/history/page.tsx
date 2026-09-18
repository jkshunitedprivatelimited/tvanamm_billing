import { listOutlets } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { ActivityHistory } from '../ActivityHistory';

export default async function AuditPage() {
  const actor = await requireAdminActor();
  const outlets = await listOutlets(db(), actor);
  return (
    <ActivityHistory
      isCentral={actor.role === 'central_admin'}
      outlets={outlets.map((o) => ({ id: o.id, name: o.displayName }))}
    />
  );
}
