import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { assertOutletInFranchise, type StockActor } from './authorize';
import { StockError } from './errors';
import { postMovement } from './ledger';
import { recordStockAudit } from './audit';

const schema = z.object({
  lines: z
    .array(z.object({ itemId: z.uuid(), quantity: z.string().regex(/^\d{1,10}(\.\d{1,6})?$/) }))
    .min(1)
    .max(500),
});

/** One optional starting count per outlet/item. Later corrections use the count review flow. */
export async function saveOpeningStock(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
  input: unknown,
) {
  if (actor.role !== 'central_admin' && actor.role !== 'franchise_owner')
    throw new StockError('forbidden', 'Only the owner or central admin can enter starting stock');
  await assertOutletInFranchise(pool, actor, outletId);
  const { lines } = schema.parse(input);
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length)
    throw new StockError('validation', 'Enter each item once');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const locations = await client.query<{ id: string; franchise_id: string }>(
      `select id,franchise_id from stock.stock_locations where outlet_id=$1 and organization_id=$2 and kind='sellable' and scope='outlet' and is_active`,
      [outletId, actor.organizationId],
    );
    const location = locations.rows[0];
    if (!location) throw new StockError('conflict', 'Stock setup is not ready for this outlet');
    for (const line of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `stock-start:${location.id}:${line.itemId}`,
      ]);
      const item = await client.query(
        `select 1 from stock.items where id=$1 and organization_id=$2 and is_active`,
        [line.itemId, actor.organizationId],
      );
      if (!item.rowCount) throw new StockError('validation', 'Choose an active stock item');
      const started = await client.query(
        `select 1 from stock.item_tracking_starts where stock_location_id=$1 and item_id=$2`,
        [location.id, line.itemId],
      );
      if (started.rowCount)
        throw new StockError(
          'conflict',
          'Stock tracking has already started for an item. Refresh this page; use a stock count for corrections.',
        );
      if (Number(line.quantity) > 0) {
        await postMovement(client, {
          organizationId: actor.organizationId,
          stockLocationId: location.id,
          itemId: line.itemId,
          quantity: line.quantity,
          movementType: 'adjustment',
          sourceDocType: 'opening_stock',
          sourceDocId: randomUUID(),
          idempotencyKey: `opening:${location.id}:${line.itemId}`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId,
          notes: 'Physical starting count',
        });
      } else {
        await client.query(
          `insert into stock.item_tracking_starts (stock_location_id,item_id) values ($1,$2)`,
          [location.id, line.itemId],
        );
      }
      await recordStockAudit(client, {
        action: 'opening_stock.recorded',
        actorRequest: actor.request,
        accountId: actor.accountId,
        organizationId: actor.organizationId,
        franchiseId: location.franchise_id,
        outletId,
        subjectType: 'stock_item',
        subjectId: line.itemId,
        data: { quantity: line.quantity },
      });
    }
    return { saved: lines.length };
  });
}
