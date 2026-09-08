import Link from 'next/link';
import { listRecalls } from '@jksh/stock';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { RecallsClient } from './recalls-client';

export const dynamic = 'force-dynamic';

export default async function RecallsPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const recalls = await listRecalls(stockDb(), stockActor);

  return (
    <main>
      <p className="muted">
        <Link href="/stock/ops">← Stock operations</Link>
      </p>
      <h1>Recalls</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Drafting a recall identifies affected locations. Activating freezes the batch for FEFO;
        quarantine each location as stock is pulled, then close.
      </p>
      <RecallsClient rows={recalls} />
    </main>
  );
}
