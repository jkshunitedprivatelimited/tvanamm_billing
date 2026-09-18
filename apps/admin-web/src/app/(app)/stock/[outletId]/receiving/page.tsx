import Link from 'next/link';
import {
  listItems,
  listPendingDeliveries,
  listLocalInwardsForOutlet,
  listDiscrepanciesForOutlet,
  listOrdersAwaitingClose,
} from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { DeliveryReceipt } from './delivery-receipt';
import { ReceivingClient } from './receiving-client';

export const dynamic = 'force-dynamic';

export default async function ReceivingPage({ params }: { params: Promise<{ outletId: string }> }) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const stockActor = await stockActorFor(actor, { outletId });

  const [items, localInwards, discrepancies, closeableOrders, deliveries] = await Promise.all([
    listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId }),
    listLocalInwardsForOutlet(stockDb(), stockActor, outletId),
    listDiscrepanciesForOutlet(stockDb(), stockActor, outletId),
    listOrdersAwaitingClose(stockDb(), stockActor, outletId),
    listPendingDeliveries(stockDb(), stockActor, outletId),
  ]);

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <h1>Receive deliveries</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Confirm the quantities that arrived to add them to your stock automatically. You can also
        record local purchases and report missing or damaged items.
      </p>
      <h2>Arriving from central</h2>
      {deliveries.length ? (
        deliveries.map((delivery) => (
          <DeliveryReceipt key={delivery.id} outletId={outletId} delivery={delivery} />
        ))
      ) : (
        <p className="card muted">No deliveries are awaiting confirmation.</p>
      )}
      <h2>Local purchases & delivery differences</h2>
      <ReceivingClient
        outletId={outletId}
        items={items.filter((i) => i.supplyRule !== 'jksh_required')}
        initialLocalInwards={localInwards}
        initialDiscrepancies={discrepancies}
        initialCloseableOrders={closeableOrders}
      />
    </main>
  );
}
