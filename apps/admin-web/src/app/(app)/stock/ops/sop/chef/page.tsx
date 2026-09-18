import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { ChefManager } from './manager';
export default async function ChefManagerPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/');
  return <ChefManager />;
}
