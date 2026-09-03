import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listTerminals } from '@jksh/identity';
import { requireActor } from '@/server/auth';
import { db } from '@/server/pool';
import { getOutlet } from '@/server/queries';
import { TerminalManager } from './manager';

export default async function OutletTerminalPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const actor = await requireActor();
  const { outletId } = await params;
  const outlet = await getOutlet(outletId);
  if (!outlet) notFound();

  const terminals = await listTerminals(db(), actor, outletId);

  return (
    <main>
      <p>
        <Link href="/">← All outlets</Link>
      </p>
      <h1>{outlet.name} · Terminal</h1>
      <p className="muted">
        One active Billing terminal per outlet. Issue an activation code, enter it on the device at{' '}
        <span className="mono">/register</span>, and it becomes the outlet terminal. Registering a
        replacement revokes the previous one.
      </p>
      <TerminalManager outletId={outletId} initialTerminals={terminals} />
    </main>
  );
}
