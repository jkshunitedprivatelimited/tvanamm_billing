import { redirect } from 'next/navigation';
import { getTransferWorkspace, listWarehouses } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { TransfersClient } from './transfers-client';
export default async function TransfersPage() {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock/ops');
  const stockActor = await stockActorFor(actor);
  const [workspace, warehouses] = await Promise.all([
    getTransferWorkspace(stockDb(), stockActor),
    listWarehouses(stockDb(), stockActor),
  ]);
  return (
    <main>
      <h1>Warehouse transfers</h1>
      <p>
        Move stock between company warehouses. Dispatch moves quantities into transit; receipt
        records the actual accepted, damaged and missing quantities.
      </p>
      <TransfersClient workspace={workspace} warehouses={warehouses} />
    </main>
  );
}
