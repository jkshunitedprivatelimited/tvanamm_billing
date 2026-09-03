import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listEmployees, listOutlets, listTerminals } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { OutletDetail } from './detail';

export default async function OutletPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const actor = await requireAdminActor();
  const { outletId } = await params;

  const outlet = (await listOutlets(db(), actor)).find((o) => o.id === outletId);
  if (!outlet) notFound();

  const [terminals, employees] = await Promise.all([
    listTerminals(db(), actor, outletId).catch(() => []),
    listEmployees(db(), actor, outletId).catch(() => []),
  ]);

  return (
    <main>
      <p>
        <Link href="/">← All outlets</Link>
      </p>
      <h1>
        {outlet.displayName} <span className="pill">{outlet.status}</span>
      </h1>
      <OutletDetail
        role={actor.role}
        outlet={outlet}
        initialTerminals={terminals}
        initialEmployees={employees}
      />
    </main>
  );
}
