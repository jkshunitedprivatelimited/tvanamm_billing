import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { IntegrationClient } from './integration-client';

export const dynamic = 'force-dynamic';

export default async function IntegrationHealthPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Billing → Stock integration</h1>
      <p className="page-intro">
        Sale events flow Billing outbox → Stock inbox → consumption, then a reconciliation run. This
        shows what is stuck and lets you re-queue an event that dead-lettered.
      </p>
      <IntegrationClient />
    </main>
  );
}
