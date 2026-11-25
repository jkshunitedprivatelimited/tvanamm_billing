import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getShipmentPreparation, getStockOrder, listWarehouses } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { ShippingPreparation } from './shipping-preparation';

export default async function ShippingPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ warehouseId?: string }>;
}) {
  const actor = await requireAdminActor();
  if (actor.role !== 'central_admin') redirect('/stock');
  const orderId = z.uuid().safeParse((await params).orderId);
  const warehouseId = z.uuid().safeParse((await searchParams).warehouseId);
  if (!orderId.success || !warehouseId.success) notFound();
  const stockActor = await stockActorFor(actor);
  const [draft, order, warehouses] = await Promise.all([
    getShipmentPreparation(stockDb(), stockActor, orderId.data, warehouseId.data),
    getStockOrder(stockDb(), stockActor, orderId.data),
    listWarehouses(stockDb(), stockActor),
  ]);
  const warehouse = warehouses.find((w) => w.id === warehouseId.data);
  if (!warehouse) notFound();
  return (
    <main>
      <Link href="/stock/ops/fulfilment">← Outlet deliveries</Link>
      <h1>Prepare prepaid delivery</h1>
      <p>
        Order {order.orderNumber} · {warehouse.name}
      </p>
      <p>
        Save the actual packed measurements and receiver details. This preparation does not book a
        courier, request pickup or move stock.
      </p>
      <ShippingPreparation orderId={orderId.data} warehouseId={warehouseId.data} initial={draft} />
    </main>
  );
}
