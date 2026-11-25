import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, assertWarehouseAccess, type StockActor } from './authorize';
import { StockError } from './errors';
import { assertPrepaidOrder } from './prepaid';
import { recordStockAudit } from './audit';

export const shipmentPreparationSchema = z
  .object({
    paymentMethod: z.literal('prepaid'),
    pickupLocation: z.string().trim().max(100),
    recipientName: z.string().trim().max(100),
    recipientPhone: z.string().trim().max(20),
    address: z.string().trim().max(500),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    pincode: z.string().trim().max(6),
    weightKg: z.number().positive().max(1000).nullable(),
    lengthCm: z.number().positive().max(1000).nullable(),
    widthCm: z.number().positive().max(1000).nullable(),
    heightCm: z.number().positive().max(1000).nullable(),
    carrierAcceptanceConfirmed: z.boolean(),
  })
  .strict();
export type ShipmentPreparationDetails = z.infer<typeof shipmentPreparationSchema>;

export function shipmentPreparationMissing(details: ShipmentPreparationDetails): string[] {
  const missing: string[] = [];
  for (const [key, label] of [
    ['pickupLocation', 'Registered warehouse pickup location'],
    ['recipientName', 'Receiver name'],
    ['address', 'Delivery address'],
    ['city', 'Delivery city'],
    ['state', 'Delivery state'],
  ] as const)
    if (!details[key]) missing.push(label);
  if (!/^\+?\d{10,15}$/.test(details.recipientPhone)) missing.push('Valid receiver phone');
  if (!/^[1-9]\d{5}$/.test(details.pincode)) missing.push('Valid six-digit delivery PIN code');
  if (!details.weightKg) missing.push('Packed weight in kg');
  if (!details.lengthCm || !details.widthCm || !details.heightCm)
    missing.push('Packed dimensions in cm');
  if (!details.carrierAcceptanceConfirmed)
    missing.push('Carrier acceptance for the actual contents');
  return missing;
}

async function authorize(pool: StockPool, actor: StockActor, orderId: string, warehouseId: string) {
  ensureStockAllowed(actor, 'stock.dispatch.operate');
  assertWarehouseAccess(actor, warehouseId);
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const row = await client.query(
      `select 1 from stock.stock_orders o join stock.warehouses w on w.organization_id=o.organization_id
       where o.id=$1 and w.id=$2 and o.organization_id=$3 and w.is_active`,
      [orderId, warehouseId, actor.organizationId],
    );
    if (!row.rowCount) throw new StockError('not_found', 'Order or warehouse not found');
  });
}

export async function getShipmentPreparation(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  warehouseId: string,
) {
  await authorize(pool, actor, orderId, warehouseId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{ revision: number; details: unknown }>(
      'select revision,details from stock.shipment_preparations where stock_order_id=$1 and warehouse_id=$2 and organization_id=$3',
      [orderId, warehouseId, actor.organizationId],
    );
    const row = rows[0];
    if (!row) return null;
    const details = shipmentPreparationSchema.parse(row.details);
    return { revision: row.revision, details, missing: shipmentPreparationMissing(details) };
  });
}

export async function saveShipmentPreparation(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  warehouseId: string,
  input: unknown,
) {
  const { expectedRevision, details } = z
    .object({ expectedRevision: z.number().int().min(0), details: shipmentPreparationSchema })
    .strict()
    .parse(input);
  await authorize(pool, actor, orderId, warehouseId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const order = await assertPrepaidOrder(client, actor, orderId);
    if (!['paid', 'approved', 'allocated', 'partially_dispatched'].includes(order.status))
      throw new StockError('conflict', 'This order is not open for shipment preparation');
    const current = await client.query<{ revision: number; details: unknown }>(
      'select revision,details from stock.shipment_preparations where stock_order_id=$1 and warehouse_id=$2 for update',
      [orderId, warehouseId],
    );
    const previous = current.rows[0];
    // Lost acknowledgements can safely retry the identical document.
    if (
      previous?.revision === expectedRevision + 1 &&
      JSON.stringify(shipmentPreparationSchema.parse(previous.details)) === JSON.stringify(details)
    )
      return { revision: previous.revision, details, missing: shipmentPreparationMissing(details) };
    if ((previous?.revision ?? 0) !== expectedRevision)
      throw new StockError('conflict', 'Shipment preparation changed. Reload before editing.');
    const revision = expectedRevision + 1;
    await client.query(
      `insert into stock.shipment_preparations(organization_id,stock_order_id,warehouse_id,revision,details,updated_by)
       values($1,$2,$3,$4,$5,$6) on conflict(stock_order_id,warehouse_id)
       do update set revision=excluded.revision,details=excluded.details,updated_by=excluded.updated_by,updated_at=now()`,
      [
        actor.organizationId,
        orderId,
        warehouseId,
        revision,
        JSON.stringify(details),
        actor.accountId ?? null,
      ],
    );
    await recordStockAudit(client, {
      action: 'shipment.preparation_saved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: actor.organizationId,
      warehouseId,
      subjectType: 'stock_order',
      subjectId: orderId,
      data: { revision, paymentMethod: 'prepaid' },
    });
    return { revision, details, missing: shipmentPreparationMissing(details) };
  });
}
