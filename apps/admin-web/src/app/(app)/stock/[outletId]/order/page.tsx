import { listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSupplyCatalogForOutlet, getStockOrder } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { stockActorFor, stockDb } from '@/server/stock';
import { OrderClient } from './order-client';

export const dynamic = 'force-dynamic';

export default async function OrderStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ outletId: string }>;
  searchParams: Promise<{ item?: string; qty?: string; order?: string }>;
}) {
  const { outletId } = await params;
  const sp = await searchParams;
  const actor = await requireAdminActor();
  const outlets = await listOutlets(db(), actor);
  const outlet = outlets.find((o) => o.id === outletId);
  const stockActor = await stockActorFor(actor, { outletId });
  if (!outlet) notFound();
  if (sp.order && !z.uuid().safeParse(sp.order).success) notFound();
  const saved = sp.order ? await getStockOrder(stockDb(), stockActor, sp.order) : null;
  if (saved && saved.outletId !== outletId) notFound();
  const catalog = saved ? [] : await getSupplyCatalogForOutlet(stockDb(), stockActor, outletId);

  return (
    <main>
      <p className="muted">
        <Link href={`/stock/${outletId}`}>← Overview</Link>
      </p>
      <p className="eyebrow">{outlet.displayName}</p>
      <h1>{saved ? saved.orderNumber : 'Order stock'}</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Choose your supplies and quantities, then review the final total before payment. Prices
        include GST. Your order is dispatched after payment is confirmed.
      </p>
      <OrderClient
        outletId={outletId}
        {...(saved
          ? {
              initialOrder: {
                id: saved.id,
                totalPaise: saved.totalPaise,
                status: saved.status,
                quantities: Object.fromEntries(
                  saved.lines.map((l) => [l.supplyCatalogItemId, l.qtyBase]),
                ),
              },
            }
          : {})}
        catalog={
          saved
            ? saved.lines.map((l) => ({
                id: l.supplyCatalogItemId,
                itemId: l.itemId,
                name: l.itemName,
                sku: '',
                baseUnit: l.baseUnit,
                orderPackBase: l.qtyBase,
                pricePaise: l.unitPricePaise,
                gstRate: 'Included',
              }))
            : catalog.map((c) => ({
                id: c.id,
                itemId: c.itemId,
                name: c.itemName,
                sku: c.sku,
                baseUnit: c.baseUnit,
                orderPackBase: c.orderPackBase,
                pricePaise: c.gstInclusivePricePaise,
                gstRate: c.gstRate,
              }))
        }
        {...(sp.item ? { initialItemId: sp.item } : {})}
        {...(sp.qty ? { initialQty: sp.qty } : {})}
      />
    </main>
  );
}
