import { randomUUID } from 'node:crypto';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import { StockError } from './errors';
import { allocateFefo, type BatchPosition } from './fefo';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface MovementInput {
  organizationId: string;
  stockLocationId: string;
  itemId: string;
  batchId?: string | null;
  /** signed fixed-point decimal string in the item base unit: + in, - out */
  quantity: string;
  movementType: string;
  unitCostPaise?: number | null;
  sourceDocType: string;
  sourceDocId?: string | null;
  idempotencyKey: string;
  correlationId?: string | null;
  actorRequest?: string | null;
  actorAccountId?: string | null;
  actorEmployeeId?: string | null;
  notes?: string | null;
}

export interface MovementResult {
  movementId: string;
  duplicate: boolean;
  onHand: string;
}

interface LocationRow {
  organization_id: string;
  warehouse_id: string | null;
  outlet_id: string | null;
  franchise_id: string | null;
}

/**
 * Append one immutable movement and update its balance projection atomically
 * (Core Invariants 1-2). Idempotent on (organization_id, idempotency_key): a
 * duplicate command returns the original movement and does not double-post.
 * An advisory transaction lock on (location,item,batch) serialises concurrent
 * posts to the same position.
 */
export async function postMovement(
  client: StockPoolClient,
  input: MovementInput,
): Promise<MovementResult> {
  const existing = await client.query<{
    id: string;
    stock_location_id: string;
    item_id: string;
    batch_id: string | null;
    quantity: string;
    movement_type: string;
  }>(
    `select id, stock_location_id, item_id, batch_id, quantity, movement_type
       from stock.stock_movements where organization_id = $1 and idempotency_key = $2`,
    [input.organizationId, input.idempotencyKey],
  );
  const dup = existing.rows[0];
  if (dup) {
    // A true retry replays the exact same command. A reuse of the key with
    // different parameters is a caller bug, not a duplicate - fail loudly.
    const same =
      dup.stock_location_id === input.stockLocationId &&
      dup.item_id === input.itemId &&
      (dup.batch_id ?? null) === (input.batchId ?? null) &&
      dup.movement_type === input.movementType &&
      Number(dup.quantity) === Number(input.quantity);
    if (!same) {
      throw new StockError(
        'conflict',
        'Idempotency key reused with different movement parameters',
        {
          details: { idempotencyKey: input.idempotencyKey, existingMovementId: dup.id },
        },
      );
    }
    const bal = await currentOnHand(
      client,
      input.stockLocationId,
      input.itemId,
      input.batchId ?? null,
    );
    return { movementId: dup.id, duplicate: true, onHand: bal };
  }

  const loc = await client.query<LocationRow>(
    `select organization_id, warehouse_id, outlet_id, franchise_id
       from stock.stock_locations where id = $1`,
    [input.stockLocationId],
  );
  const location = loc.rows[0];
  if (!location) throw new StockError('not_found', 'Stock location not found');
  if (location.organization_id !== input.organizationId) {
    throw new StockError('validation', 'Location belongs to another organization');
  }

  // The item must exist and belong to the same organization.
  const item = await client.query<{ organization_id: string }>(
    'select organization_id from stock.items where id = $1',
    [input.itemId],
  );
  if (!item.rows[0]) throw new StockError('not_found', 'Item not found');
  if (item.rows[0].organization_id !== input.organizationId) {
    throw new StockError('validation', 'Item belongs to another organization');
  }

  // A named batch must belong to this item and organization.
  if (input.batchId) {
    const batch = await client.query<{ item_id: string; organization_id: string }>(
      'select item_id, organization_id from stock.batches where id = $1',
      [input.batchId],
    );
    if (!batch.rows[0]) throw new StockError('not_found', 'Batch not found');
    if (batch.rows[0].item_id !== input.itemId) {
      throw new StockError('validation', 'Batch does not belong to this item');
    }
    if (batch.rows[0].organization_id !== input.organizationId) {
      throw new StockError('validation', 'Batch belongs to another organization');
    }
  }

  const batchKey = input.batchId ?? NIL_UUID;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${input.stockLocationId}:${input.itemId}:${batchKey}`,
  ]);

  const movementId = randomUUID();
  await client.query(
    `insert into stock.stock_movements
       (id, organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
        item_id, batch_id, quantity, movement_type, unit_cost_paise, source_doc_type,
        source_doc_id, idempotency_key, correlation_id, actor_request, actor_account_id,
        actor_employee_id, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      movementId,
      input.organizationId,
      input.stockLocationId,
      location.warehouse_id,
      location.outlet_id,
      location.franchise_id,
      input.itemId,
      input.batchId ?? null,
      input.quantity,
      input.movementType,
      input.unitCostPaise ?? null,
      input.sourceDocType,
      input.sourceDocId ?? null,
      input.idempotencyKey,
      input.correlationId ?? null,
      input.actorRequest ?? null,
      input.actorAccountId ?? null,
      input.actorEmployeeId ?? null,
      input.notes ?? null,
    ],
  );

  const balance = await client.query<{ on_hand: string }>(
    `insert into stock.stock_balances
       (organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
        item_id, batch_id, on_hand)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (stock_location_id, item_id, coalesce(batch_id, '${NIL_UUID}'::uuid))
     do update set on_hand = stock.stock_balances.on_hand + excluded.on_hand,
                   updated_at = now()
     returning on_hand`,
    [
      input.organizationId,
      input.stockLocationId,
      location.warehouse_id,
      location.outlet_id,
      location.franchise_id,
      input.itemId,
      input.batchId ?? null,
      input.quantity,
    ],
  );

  await updateValuation(client, input);

  return { movementId, duplicate: false, onHand: balance.rows[0]?.on_hand ?? '0' };
}

async function updateValuation(client: StockPoolClient, input: MovementInput): Promise<void> {
  const qty = Number(input.quantity);
  if (qty > 0 && input.unitCostPaise != null) {
    await client.query(
      `insert into stock.item_valuation (organization_id, item_id, avg_cost_paise, on_hand_qty)
       values ($1,$2,$3,$4)
       on conflict (organization_id, item_id) do update set
         avg_cost_paise = case
           when stock.item_valuation.on_hand_qty + excluded.on_hand_qty > 0
           then (stock.item_valuation.on_hand_qty * stock.item_valuation.avg_cost_paise
                 + excluded.on_hand_qty * excluded.avg_cost_paise)
                / (stock.item_valuation.on_hand_qty + excluded.on_hand_qty)
           else excluded.avg_cost_paise end,
         on_hand_qty = stock.item_valuation.on_hand_qty + excluded.on_hand_qty,
         updated_at = now()`,
      [input.organizationId, input.itemId, input.unitCostPaise, input.quantity],
    );
  } else if (qty < 0) {
    await client.query(
      `update stock.item_valuation
          set on_hand_qty = greatest(0, on_hand_qty + $3), updated_at = now()
        where organization_id = $1 and item_id = $2`,
      [input.organizationId, input.itemId, input.quantity],
    );
  }
}

async function currentOnHand(
  client: StockPoolClient,
  locationId: string,
  itemId: string,
  batchId: string | null,
): Promise<string> {
  const { rows } = await client.query<{ on_hand: string }>(
    `select on_hand from stock.stock_balances
      where stock_location_id = $1 and item_id = $2
        and coalesce(batch_id, '${NIL_UUID}'::uuid) = coalesce($3::uuid, '${NIL_UUID}'::uuid)`,
    [locationId, itemId, batchId],
  );
  return rows[0]?.on_hand ?? '0';
}

/** Post several movements in one transaction under the system context. */
export async function postMovements(
  pool: StockPool,
  entries: MovementInput[],
): Promise<MovementResult[]> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const out: MovementResult[] = [];
    for (const entry of entries) {
      out.push(await postMovement(client, entry));
    }
    return out;
  });
}

export interface FefoPick {
  batchId: string | null;
  quantity: string;
}

/**
 * FEFO batch pick for an outbound issue at a location. Reads usable balances
 * (on_hand - allocated) for active, non-recalled batches. Returns the picks and
 * any `shortfall`; the caller decides whether a shortfall warns (sale
 * consumption) or blocks (dispatch allocation).
 */
export async function pickFefo(
  client: StockPoolClient,
  locationId: string,
  itemId: string,
  quantityBase: string,
): Promise<{ picks: FefoPick[]; shortfall: string }> {
  const { rows } = await client.query<{
    batch_id: string | null;
    usable: string;
    expiry_date: string | null;
    created_at: string;
  }>(
    `select b.on_hand - b.allocated as usable,
            b.batch_id,
            bt.expiry_date::text as expiry_date,
            coalesce(bt.created_at, b.updated_at) as created_at
       from stock.stock_balances b
       left join stock.batches bt on bt.id = b.batch_id
      where b.stock_location_id = $1 and b.item_id = $2
        and b.on_hand - b.allocated > 0
        and (bt.id is null or (bt.status = 'active' and bt.recall_id is null))`,
    [locationId, itemId],
  );

  const positions: BatchPosition[] = rows.map((r) => ({
    batchId: r.batch_id,
    usable: Number(r.usable),
    expiryDate: r.expiry_date,
    createdAt: r.created_at,
  }));

  const result = allocateFefo(positions, Number(quantityBase));
  return {
    picks: result.allocations.map((a) => ({ batchId: a.batchId, quantity: a.quantity.toFixed(6) })),
    shortfall: result.shortfall.toFixed(6),
  };
}

/**
 * Rebuild balance and valuation projections for one organization by replaying
 * the ledger (Core Invariant 2). Used by reconciliation and tests.
 */
export async function rebuildProjections(pool: StockPool, organizationId: string): Promise<void> {
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query('delete from stock.stock_balances where organization_id = $1', [
      organizationId,
    ]);
    await client.query('delete from stock.item_valuation where organization_id = $1', [
      organizationId,
    ]);
    await client.query(
      `insert into stock.stock_balances
         (organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
          item_id, batch_id, on_hand)
       select organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
              item_id, batch_id, sum(quantity)
         from stock.stock_movements
        where organization_id = $1
        group by organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
                 item_id, batch_id`,
      [organizationId],
    );
    const inbound = await client.query<{
      item_id: string;
      quantity: string;
      unit_cost_paise: string;
    }>(
      `select item_id, quantity, unit_cost_paise
         from stock.stock_movements
        where organization_id = $1 and quantity > 0 and unit_cost_paise is not null
        order by occurred_at, id`,
      [organizationId],
    );
    for (const row of inbound.rows) {
      await client.query(
        `insert into stock.item_valuation (organization_id, item_id, avg_cost_paise, on_hand_qty)
         values ($1,$2,$3,$4)
         on conflict (organization_id, item_id) do update set
           avg_cost_paise = case
             when stock.item_valuation.on_hand_qty + excluded.on_hand_qty > 0
             then (stock.item_valuation.on_hand_qty * stock.item_valuation.avg_cost_paise
                   + excluded.on_hand_qty * excluded.avg_cost_paise)
                  / (stock.item_valuation.on_hand_qty + excluded.on_hand_qty)
             else excluded.avg_cost_paise end,
           on_hand_qty = stock.item_valuation.on_hand_qty + excluded.on_hand_qty`,
        [organizationId, row.item_id, row.unit_cost_paise, row.quantity],
      );
    }
    // Outbound quantities reduce valuation on_hand without touching the average.
    await client.query(
      `update stock.item_valuation v set on_hand_qty = greatest(0, v.on_hand_qty + coalesce(o.out_qty, 0))
         from (select item_id, sum(quantity) as out_qty
                 from stock.stock_movements
                where organization_id = $1 and quantity < 0
                group by item_id) o
        where v.organization_id = $1 and v.item_id = o.item_id`,
      [organizationId],
    );
  });
}
