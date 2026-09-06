import { randomUUID } from 'node:crypto';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import { saleCompletedPayloadSchema, saleRefundedPayloadSchema } from '@jksh/contracts';
import { StockError } from './errors';
import { recordStockOutbox } from './events';
import { postMovement, pickFefo } from './ledger';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

interface InboxRow {
  id: string;
  source_event_id: string;
  event_type: string;
  payload: unknown;
  processed_at: string | null;
  correlation_id: string | null;
}

async function loadInbox(client: StockPoolClient, sourceEventId: string): Promise<InboxRow> {
  const { rows } = await client.query<InboxRow>(
    `select id, source_event_id, event_type, payload, processed_at, correlation_id
       from stock_inbox.events where source_event_id = $1`,
    [sourceEventId],
  );
  const row = rows[0];
  if (!row) throw new StockError('not_found', 'Inbox event not found');
  return row;
}

async function outletSellableLocation(
  client: StockPoolClient,
  outletId: string,
): Promise<{ id: string; organizationId: string } | null> {
  const { rows } = await client.query<{ id: string; organization_id: string }>(
    `select id, organization_id from stock.stock_locations
      where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
    [outletId],
  );
  return rows[0] ? { id: rows[0].id, organizationId: rows[0].organization_id } : null;
}

interface RecipeVersionRow {
  id: string;
  prepared_base_item_id: string | null;
  prepared_base_qty_base: string | null;
}

interface ComponentRow {
  component_type: string;
  item_id: string;
  qty_base: string;
  is_default: boolean;
  process_loss_pct: string;
}

/**
 * Consume one recipe line: a recorded prepared base if one covers the need,
 * otherwise the direct raw + packaging components - never both (Core Invariant
 * 3). A FEFO shortfall still posts the full consumption (stock may go negative)
 * and records a negative-stock exception; Billing is never rejected.
 */
async function consumeRecipeLine(
  client: StockPoolClient,
  args: {
    organizationId: string;
    locationId: string;
    outletId: string;
    businessDate: string;
    saleConsumptionId: string;
    billLineId: string | null;
    catalogItemId: string | null;
    recipeId: string;
    recipeVersion: number;
    unitsSold: number;
    correlationId: string | null;
  },
): Promise<{ shortfall: number }> {
  const rv = await client.query<RecipeVersionRow>(
    `select id, prepared_base_item_id, prepared_base_qty_base
       from stock.recipe_versions where recipe_id = $1 and version = $2`,
    [args.recipeId, args.recipeVersion],
  );
  const version = rv.rows[0];
  if (!version) throw new StockError('not_found', 'Recipe version not found for sale line');

  let totalShortfall = 0;

  // Prepared-base path: consume the intermediate if enough is on hand.
  if (version.prepared_base_item_id && version.prepared_base_qty_base) {
    const need = Number(version.prepared_base_qty_base) * args.unitsSold;
    const prep = await client.query<{
      id: string;
      qty_base_remaining: string;
      batch_id: string | null;
    }>(
      `select id, qty_base_remaining, batch_id from stock.prepared_batches
        where stock_location_id = $1 and item_id = $2 and qty_base_remaining > 0
        order by recorded_at asc limit 1`,
      [args.locationId, version.prepared_base_item_id],
    );
    const pb = prep.rows[0];
    if (pb && Number(pb.qty_base_remaining) >= need) {
      await client.query(
        'update stock.prepared_batches set qty_base_remaining = qty_base_remaining - $2 where id = $1',
        [pb.id, need.toFixed(6)],
      );
      await postMovement(client, {
        organizationId: args.organizationId,
        stockLocationId: args.locationId,
        itemId: version.prepared_base_item_id,
        batchId: pb.batch_id,
        quantity: (-need).toFixed(6),
        movementType: 'consumption',
        sourceDocType: 'sale_consumption',
        sourceDocId: args.saleConsumptionId,
        idempotencyKey: `sale:${args.saleConsumptionId}:${args.billLineId ?? args.recipeId}:prepared`,
        correlationId: args.correlationId,
        actorRequest: 'system',
        notes: 'prepared base',
      });
      await client.query(
        `insert into stock.sale_consumption_lines
           (sale_consumption_id, bill_line_id, catalog_item_id, recipe_id, recipe_version, item_id,
            batch_id, qty_base, from_prepared)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [
          args.saleConsumptionId,
          args.billLineId,
          args.catalogItemId,
          args.recipeId,
          args.recipeVersion,
          version.prepared_base_item_id,
          pb.batch_id,
          need.toFixed(6),
        ],
      );
      return { shortfall: 0 };
    }
  }

  // Raw path: fixed + packaging + default alternative components.
  const comps = await client.query<ComponentRow>(
    `select component_type, item_id, qty_base, is_default, process_loss_pct
       from stock.recipe_components where recipe_version_id = $1`,
    [version.id],
  );
  for (const c of comps.rows) {
    const consumed =
      c.component_type === 'fixed' ||
      c.component_type === 'packaging' ||
      (c.component_type === 'alternative' && c.is_default);
    if (!consumed) continue;

    const required = Number(c.qty_base) * args.unitsSold * (1 + Number(c.process_loss_pct) / 100);
    const { picks, shortfall } = await pickFefo(
      client,
      args.locationId,
      c.item_id,
      required.toFixed(6),
    );
    const shortfallNum = Number(shortfall);

    // Post one movement per picked batch, plus the shortfall against no batch.
    for (const pick of picks) {
      await postMovement(client, {
        organizationId: args.organizationId,
        stockLocationId: args.locationId,
        itemId: c.item_id,
        batchId: pick.batchId,
        quantity: (-Number(pick.quantity)).toFixed(6),
        movementType: 'consumption',
        sourceDocType: 'sale_consumption',
        sourceDocId: args.saleConsumptionId,
        idempotencyKey: `sale:${args.saleConsumptionId}:${args.billLineId ?? args.recipeId}:${c.item_id}:${pick.batchId ?? 'nb'}`,
        correlationId: args.correlationId,
        actorRequest: 'system',
      });
    }
    if (shortfallNum > 0) {
      await postMovement(client, {
        organizationId: args.organizationId,
        stockLocationId: args.locationId,
        itemId: c.item_id,
        batchId: null,
        quantity: (-shortfallNum).toFixed(6),
        movementType: 'consumption',
        sourceDocType: 'sale_consumption',
        sourceDocId: args.saleConsumptionId,
        idempotencyKey: `sale:${args.saleConsumptionId}:${args.billLineId ?? args.recipeId}:${c.item_id}:shortfall`,
        correlationId: args.correlationId,
        actorRequest: 'system',
        notes: 'negative-stock shortfall',
      });
      await client.query(
        `insert into stock.negative_stock_exceptions
           (organization_id, outlet_id, stock_location_id, item_id, sale_consumption_id, qty_base,
            business_date)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          args.organizationId,
          args.outletId,
          args.locationId,
          c.item_id,
          args.saleConsumptionId,
          shortfallNum.toFixed(6),
          args.businessDate,
        ],
      );
      totalShortfall += shortfallNum;
    }

    await client.query(
      `insert into stock.sale_consumption_lines
         (sale_consumption_id, bill_line_id, catalog_item_id, recipe_id, recipe_version, item_id,
          qty_base, negative_shortfall_base)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        args.saleConsumptionId,
        args.billLineId,
        args.catalogItemId,
        args.recipeId,
        args.recipeVersion,
        c.item_id,
        required.toFixed(6),
        shortfallNum.toFixed(6),
      ],
    );
  }
  return { shortfall: totalShortfall };
}

export interface ProcessResult {
  saleConsumptionId: string;
  status: string;
  duplicate: boolean;
  negativeExceptions: number;
}

/**
 * Consume raw materials for a completed sale. Idempotent on the source event id
 * (`billing-stock-recipe-contract.md` "Sale Event"). An item without a recipe
 * is `not_stock_tracked` and skipped.
 */
export async function processSaleCompleted(
  pool: StockPool,
  sourceEventId: string,
): Promise<ProcessResult> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const existing = await client.query<{ id: string; status: string }>(
      'select id, status from stock.sale_consumptions where source_event_id = $1',
      [sourceEventId],
    );
    if (existing.rows[0]) {
      const negCount = await client.query<{ n: string }>(
        'select count(*) as n from stock.negative_stock_exceptions where sale_consumption_id = $1',
        [existing.rows[0].id],
      );
      return {
        saleConsumptionId: existing.rows[0].id,
        status: existing.rows[0].status,
        duplicate: true,
        negativeExceptions: Number(negCount.rows[0]?.n ?? '0'),
      };
    }

    const inbox = await loadInbox(client, sourceEventId);
    if (inbox.event_type !== 'SaleCompleted') {
      throw new StockError('validation', `Expected SaleCompleted, got ${inbox.event_type}`);
    }
    const parsed = saleCompletedPayloadSchema.safeParse(inbox.payload);
    if (!parsed.success) {
      throw new StockError('validation', 'Malformed SaleCompleted payload', {
        details: { issues: parsed.error.issues },
      });
    }
    const payload = parsed.data;

    const loc = await outletSellableLocation(client, payload.outletId);
    const consumptionId = randomUUID();
    await client.query(
      `insert into stock.sale_consumptions
         (id, organization_id, source_event_id, event_type, bill_id, outlet_id, business_date, status)
       values ($1,$2,$3,'SaleCompleted',$4,$5,$6,$7)`,
      [
        consumptionId,
        loc?.organizationId ?? NIL_UUID,
        sourceEventId,
        payload.billId,
        payload.outletId,
        payload.businessDate,
        'processed',
      ],
    );

    let totalShortfall = 0;
    if (loc) {
      for (const line of payload.lines) {
        if (line.stockRecipeId && line.stockRecipeVersion) {
          const res = await consumeRecipeLine(client, {
            organizationId: loc.organizationId,
            locationId: loc.id,
            outletId: payload.outletId,
            businessDate: payload.businessDate,
            saleConsumptionId: consumptionId,
            billLineId: line.billLineId,
            catalogItemId: line.catalogItemId,
            recipeId: line.stockRecipeId,
            recipeVersion: line.stockRecipeVersion,
            unitsSold: line.quantity,
            correlationId: inbox.correlation_id,
          });
          totalShortfall += res.shortfall;
        }
        for (const addon of line.addons) {
          if (addon.stockRecipeId && addon.stockRecipeVersion) {
            const res = await consumeRecipeLine(client, {
              organizationId: loc.organizationId,
              locationId: loc.id,
              outletId: payload.outletId,
              businessDate: payload.businessDate,
              saleConsumptionId: consumptionId,
              billLineId: line.billLineId,
              catalogItemId: line.catalogItemId,
              recipeId: addon.stockRecipeId,
              recipeVersion: addon.stockRecipeVersion,
              unitsSold: addon.quantity,
              correlationId: inbox.correlation_id,
            });
            totalShortfall += res.shortfall;
          }
        }
      }
    }

    const status = totalShortfall > 0 ? 'negative_exception' : 'processed';
    await client.query('update stock.sale_consumptions set status = $2 where id = $1', [
      consumptionId,
      status,
    ]);

    const negCount = await client.query<{ n: string }>(
      'select count(*) as n from stock.negative_stock_exceptions where sale_consumption_id = $1',
      [consumptionId],
    );
    await recordStockOutbox(client, {
      aggregateType: 'sale_consumption',
      aggregateId: consumptionId,
      eventType: 'SaleConsumptionProcessed',
      correlationId: inbox.correlation_id,
      payload: {
        billId: payload.billId,
        outletId: payload.outletId,
        status,
        negativeExceptions: Number(negCount.rows[0]?.n ?? '0'),
      },
    });
    await client.query(
      `update stock_inbox.events set processed_at = now(), process_result = $2 where id = $1`,
      [inbox.id, JSON.stringify({ saleConsumptionId: consumptionId, status })],
    );

    return {
      saleConsumptionId: consumptionId,
      status,
      duplicate: false,
      negativeExceptions: Number(negCount.rows[0]?.n ?? '0'),
    };
  });
}

/**
 * A refund never restores consumed materials (Core Invariant 8). With no
 * kitchen/preparation state in the MVP there is no prepared item to waste
 * either, so this records the event and its no-op result and acknowledges the
 * inbox.
 */
export async function processSaleRefunded(
  pool: StockPool,
  sourceEventId: string,
): Promise<{ saleConsumptionId: string; duplicate: boolean }> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const existing = await client.query<{ id: string }>(
      'select id from stock.sale_consumptions where source_event_id = $1',
      [sourceEventId],
    );
    if (existing.rows[0]) return { saleConsumptionId: existing.rows[0].id, duplicate: true };

    const inbox = await loadInbox(client, sourceEventId);
    if (inbox.event_type !== 'SaleRefunded') {
      throw new StockError('validation', `Expected SaleRefunded, got ${inbox.event_type}`);
    }
    const parsed = saleRefundedPayloadSchema.safeParse(inbox.payload);
    if (!parsed.success) {
      throw new StockError('validation', 'Malformed SaleRefunded payload');
    }
    const id = randomUUID();
    await client.query(
      `insert into stock.sale_consumptions
         (id, organization_id, source_event_id, event_type, bill_id, status)
       values ($1,$2,$3,'SaleRefunded',$4,'refund_noop')`,
      [id, NIL_UUID, sourceEventId, parsed.data.billId],
    );
    await recordStockOutbox(client, {
      aggregateType: 'sale_consumption',
      aggregateId: id,
      eventType: 'SaleConsumptionProcessed',
      correlationId: inbox.correlation_id,
      payload: {
        billId: parsed.data.billId,
        refundId: parsed.data.refundId,
        status: 'refund_noop',
      },
    });
    await client.query(
      `update stock_inbox.events set processed_at = now(), process_result = $2 where id = $1`,
      [inbox.id, JSON.stringify({ saleConsumptionId: id, status: 'refund_noop' })],
    );
    return { saleConsumptionId: id, duplicate: false };
  });
}
