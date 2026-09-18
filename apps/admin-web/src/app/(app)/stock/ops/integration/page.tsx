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
      <h1>Stock update status</h1>
      <p className="page-intro">
        Check whether completed bills have updated stock. Review pending updates or retry failures.
        Billing can continue while stock updates are being processed.
      </p>
      <IntegrationClient />
    </main>
  );
}
