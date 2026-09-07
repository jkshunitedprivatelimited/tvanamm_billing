import Link from 'next/link';
import { getSupplyCatalogForOutlet } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { OrderClient } from './order-client';

export const dynamic = 'force-dynamic';

export default async function OrderStockPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const { outletId } = await params;
  const actor = await requireAdminActor();
  const stockActor = await stockActorFor(actor, { outletId });
  const catalog = await getSupplyCatalogForOutlet(stockDb(), stockActor, outletId);

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <h1>Order stock</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Prices are GST-inclusive and snapshotted from the JKSH catalog. Payment is prepaid through
        Razorpay; dispatch is blocked until the payment is verified.
      </p>
      <OrderClient
        outletId={outletId}
        catalog={catalog.map((c) => ({
          id: c.id,
          name: c.itemName,
          sku: c.sku,
          pricePaise: c.gstInclusivePricePaise,
          gstRate: c.gstRate,
        }))}
      />
    </main>
  );
}
