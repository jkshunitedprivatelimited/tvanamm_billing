import type { StockPoolClient } from '@jksh/db';
import { StockError } from './errors';

interface ItemUnitRow {
  base_unit: string;
  dimension: string;
}

/**
 * Convert `qty` expressed in `unit` to the item's base unit, as a fixed-point
 * decimal string. Resolves an item-specific conversion first (e.g. one "spoon"
 * of tea powder), then a global unit factor. Volume never silently implies
 * weight (`t-vanamm-recipe-standardization.md`).
 */
export async function toBaseQuantity(
  client: StockPoolClient,
  itemId: string,
  unit: string,
  qty: number | string,
): Promise<string> {
  const item = await client.query<ItemUnitRow>(
    'select base_unit, dimension::text as dimension from stock.items where id = $1',
    [itemId],
  );
  const row = item.rows[0];
  if (!row) throw new StockError('not_found', 'Item not found');

  if (unit === row.base_unit) {
    return numeric(qty);
  }

  const specific = await client.query<{ to_base_qty: string }>(
    `select to_base_qty from stock.item_unit_conversions
      where item_id = $1 and lower(from_unit) = lower($2) and is_current`,
    [itemId, unit],
  );
  if (specific.rows[0]) {
    return multiply(qty, specific.rows[0].to_base_qty);
  }

  const global = await client.query<{ to_base_factor: string; dimension: string }>(
    'select to_base_factor, dimension::text as dimension from stock.units where code = $1',
    [unit],
  );
  const g = global.rows[0];
  if (!g) throw new StockError('validation', `Unknown unit: ${unit}`);
  if (g.dimension !== row.dimension) {
    throw new StockError('validation', `Unit ${unit} is ${g.dimension}, item is ${row.dimension}`, {
      details: { unit, itemId },
    });
  }
  return multiply(qty, g.to_base_factor);
}

function numeric(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw new StockError('validation', 'Quantity is not a finite number');
  return n.toFixed(6);
}

function multiply(qty: number | string, factor: string): string {
  const q = typeof qty === 'string' ? Number(qty) : qty;
  const f = Number(factor);
  if (!Number.isFinite(q) || !Number.isFinite(f)) {
    throw new StockError('validation', 'Non-finite quantity or factor');
  }
  return (q * f).toFixed(6);
}
