import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { type StockActor, assertOutletInFranchise } from './authorize';
import { StockError } from './errors';
import { postMovement } from './ledger';
import { recordStockAudit } from './audit';
import { toBaseQuantity } from './units';

export const employeeStockEntrySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['purchase', 'wastage', 'count']),
    itemId: z.union([z.uuid(), z.literal('other')]),
    otherItemName: z.string().trim().min(1).max(120).optional(),
    quantity: z.string().regex(/^\d{1,8}(\.\d{1,6})?$/),
    unit: z.enum(['g', 'kg', 'ml', 'l', 'each']),
    reason: z.string().trim().min(1).max(500),
    wasteReason: z
      .enum([
        'spoilage',
        'breakage',
        'expiry',
        'preparation_loss',
        'customer_cancelled',
        'pest',
        'other',
      ])
      .optional(),
    amount: z
      .string()
      .regex(/^\d{1,8}\.\d{2}$/)
      .optional(),
    paymentSource: z
      .enum(['shared_cash_drawer', 'outlet_upi', 'owner_paid', 'employee_paid'])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.itemId === 'other' && (v.kind !== 'wastage' || !v.otherItemName))
      ctx.addIssue({ code: 'custom', message: 'Enter the name of the wasted item' });
    if (v.itemId !== 'other' && v.otherItemName)
      ctx.addIssue({ code: 'custom', message: 'Choose a listed item or enter another item' });
    if (v.kind !== 'count' && Number(v.quantity) <= 0)
      ctx.addIssue({ code: 'custom', message: 'Enter a quantity greater than zero' });
    if (v.kind === 'purchase' && (!v.amount || Number(v.amount) <= 0 || !v.paymentSource))
      ctx.addIssue({ code: 'custom', message: 'Enter the amount paid and payment source' });
    if (v.kind === 'wastage' && !v.wasteReason)
      ctx.addIssue({ code: 'custom', message: 'Choose a wastage reason' });
  });
export type EmployeeStockEntry = z.infer<typeof employeeStockEntrySchema>;
export interface EntryExpense {
  idempotencyKey: string;
  categoryName: string;
  amount: string;
  paymentSource: 'shared_cash_drawer' | 'outlet_upi' | 'owner_paid' | 'employee_paid';
  reason: string;
}
function requireEmployee(actor: StockActor) {
  if (actor.request !== 'operator' || !actor.employeeId || !actor.outletId)
    throw new StockError('forbidden', 'Sign in at your outlet to record stock');
  return { employeeId: actor.employeeId, outletId: actor.outletId };
}

export async function listEmployeeStockEntries(pool: StockPool, actor: StockActor) {
  const { employeeId, outletId } = requireEmployee(actor);
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(
    pool,
    stockSystemContext(),
    async (c) =>
      (
        await c.query<{
          id: string;
          command: EmployeeStockEntry;
          result: Record<string, unknown> | null;
          created_at: Date;
        }>(
          `select id,command,result,created_at from stock.employee_stock_entries where organization_id=$1 and outlet_id=$2 and employee_id=$3 order by (result is null) desc,created_at desc limit 50`,
          [actor.organizationId, outletId, employeeId],
        )
      ).rows,
  );
}

/** The durable request is saved first. A failed expense/commit leaves it retryable.
 * Expense callback MUST be idempotent by the supplied key, including after a lost response. */
export async function recordEmployeeStockEntry(
  pool: StockPool,
  actor: StockActor,
  employeeName: string,
  input: unknown,
  saveExpense: (expense: EntryExpense) => Promise<{ id: string }>,
) {
  const { employeeId, outletId } = requireEmployee(actor);
  await assertOutletInFranchise(pool, actor, outletId);
  const cmd = employeeStockEntrySchema.parse(input);
  await withStockActorContext(pool, stockSystemContext(), async (c) => {
    // Validate before persisting so a bad item or unit cannot leave an unrecoverable request.
    if (cmd.itemId !== 'other') {
      const item = await c.query<{ supply_rule: string; is_batch_tracked: boolean }>(
        'select supply_rule,is_batch_tracked from stock.items where id=$1 and organization_id=$2 and is_active',
        [cmd.itemId, actor.organizationId],
      );
      if (!item.rows[0]) throw new StockError('validation', 'Choose an available stock item');
      if (cmd.kind === 'purchase' && item.rows[0].supply_rule === 'jksh_required')
        throw new StockError('forbidden', 'This item must be received through a supply order');
      if (item.rows[0].is_batch_tracked)
        throw new StockError(
          'validation',
          'This item needs a batch-specific entry in the stock workspace',
        );
      await toBaseQuantity(c, cmd.itemId, cmd.unit, cmd.quantity);
    }
    const settings = await c.query(
      'select 1 from stock.outlet_stock_settings where outlet_id=$1 and organization_id=$2',
      [outletId, actor.organizationId],
    );
    if (!settings.rowCount)
      throw new StockError('conflict', 'Stock is not available for this outlet yet');
    await c.query(
      `insert into stock.employee_stock_entries(id,organization_id,outlet_id,employee_id,employee_name,command) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing`,
      [cmd.id, actor.organizationId, outletId, employeeId, employeeName, JSON.stringify(cmd)],
    );
  });
  return withStockActorContext(pool, stockSystemContext(), async (c) => {
    const req = (
      await c.query<{ command: EmployeeStockEntry; result: Record<string, unknown> | null }>(
        `select command,result from stock.employee_stock_entries where id=$1 and organization_id=$2 and outlet_id=$3 and employee_id=$4 for update`,
        [cmd.id, actor.organizationId, outletId, employeeId],
      )
    ).rows[0];
    if (!req) throw new StockError('forbidden', 'This entry belongs to another session');
    if (JSON.stringify(employeeStockEntrySchema.parse(req.command)) !== JSON.stringify(cmd))
      throw new StockError('conflict', 'Retry the original entry without changing its details');
    if (req.result) return req.result;
    if (cmd.itemId === 'other') {
      // Unlisted losses are recorded for the owner, never deducted from an unrelated item.
      const result = {
        id: cmd.id,
        kind: cmd.kind,
        itemName: cmd.otherItemName,
        expenseId: null,
        status: 'recorded',
        stockUpdated: false,
      };
      await recordStockAudit(c, {
        action: 'employee_stock.wastage',
        actorRequest: 'operator',
        employeeId,
        organizationId: actor.organizationId,
        outletId,
        franchiseId: actor.franchiseId,
        subjectType: 'employee_stock_entry',
        subjectId: cmd.id,
        data: {
          employeeName,
          itemName: cmd.otherItemName,
          quantity: cmd.quantity,
          unit: cmd.unit,
          reason: cmd.reason,
          wasteReason: cmd.wasteReason,
          stockUpdated: false,
        },
      });
      await c.query(
        'update stock.employee_stock_entries set result=$2,completed_at=now() where id=$1',
        [cmd.id, JSON.stringify(result)],
      );
      return result;
    }
    const location = (
      await c.query<{ id: string; franchise_id: string | null }>(
        `select id,franchise_id from stock.stock_locations where organization_id=$1 and outlet_id=$2 and scope='outlet' and kind='sellable' and is_active`,
        [actor.organizationId, outletId],
      )
    ).rows[0];
    if (!location) throw new StockError('conflict', 'Stock is not available for this outlet yet');
    const item = (
      await c.query<{ name: string; base_unit: string }>(
        `select name,base_unit from stock.items where id=$1 and organization_id=$2 and is_active`,
        [cmd.itemId, actor.organizationId],
      )
    ).rows[0];
    if (!item) throw new StockError('validation', 'Item is no longer available');
    const qty = await toBaseQuantity(c, cmd.itemId, cmd.unit, cmd.quantity);
    const note = `${employeeName}: ${cmd.reason}`;
    let expenseId: string | null = null;
    if (cmd.kind === 'count') {
      await c.query(
        `insert into stock.stock_counts(id,organization_id,stock_location_id,outlet_id,franchise_id,count_type,status,period_label) values($1,$2,$3,$4,$5,'cycle','review',$6)`,
        [cmd.id, actor.organizationId, location.id, outletId, location.franchise_id, note],
      );
      await c.query(
        `insert into stock.stock_count_lines(stock_count_id,item_id,system_qty_base,counted_qty_base,reason) select $1,$2,coalesce(sum(on_hand),0),$3,$4 from stock.stock_balances where stock_location_id=$5 and item_id=$2 and batch_id is null`,
        [cmd.id, cmd.itemId, qty, note, location.id],
      );
      await c.query('insert into stock.count_adjustment_approvals(stock_count_id) values($1)', [
        cmd.id,
      ]);
    } else {
      const unitCost = cmd.amount ? (Number(cmd.amount) * 100) / Number(qty) : null;
      const exactUnitCost = unitCost === null ? null : Number(unitCost.toFixed(6));
      const movement = await postMovement(c, {
        organizationId: actor.organizationId,
        stockLocationId: location.id,
        itemId: cmd.itemId,
        quantity: cmd.kind === 'purchase' ? qty : `-${qty}`,
        movementType: cmd.kind === 'purchase' ? 'receipt' : 'wastage',
        sourceDocType: cmd.kind === 'purchase' ? 'local_inward' : 'wastage_event',
        sourceDocId: cmd.id,
        idempotencyKey: `employee-entry:${cmd.id}`,
        actorRequest: actor.request,
        actorEmployeeId: employeeId,
        notes: note,
        ...(exactUnitCost !== null ? { unitCostPaise: exactUnitCost } : {}),
      });
      if (cmd.kind === 'purchase') {
        await c.query(
          `insert into stock.local_inwards(id,organization_id,outlet_id,franchise_id,stock_location_id,item_id,qty_base,unit_cost_paise,valuation_state,movement_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            cmd.id,
            actor.organizationId,
            outletId,
            location.franchise_id,
            location.id,
            cmd.itemId,
            qty,
            exactUnitCost,
            exactUnitCost === null ? 'cost_pending' : 'costed',
            movement.movementId,
          ],
        );
        if (!cmd.amount || !cmd.paymentSource)
          throw new StockError('validation', 'Payment details are required');
        expenseId = (
          await saveExpense({
            idempotencyKey: `stock-purchase:${cmd.id}`,
            categoryName: item.name,
            amount: cmd.amount,
            paymentSource: cmd.paymentSource,
            reason: `Local purchase: ${cmd.quantity} ${cmd.unit} ${item.name}. ${cmd.reason}`.slice(
              0,
              500,
            ),
          })
        ).id;
      } else {
        await c.query(
          `insert into stock.wastage_events(id,organization_id,stock_location_id,outlet_id,franchise_id,item_id,qty_base,reason,movement_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            cmd.id,
            actor.organizationId,
            location.id,
            outletId,
            location.franchise_id,
            cmd.itemId,
            qty,
            cmd.wasteReason,
            movement.movementId,
          ],
        );
      }
    }
    const result = {
      id: cmd.id,
      kind: cmd.kind,
      itemName: item.name,
      expenseId,
      status: cmd.kind === 'count' ? 'review' : 'recorded',
    };
    await recordStockAudit(c, {
      action: `employee_stock.${cmd.kind}`,
      actorRequest: 'operator',
      employeeId,
      organizationId: actor.organizationId,
      outletId,
      franchiseId: location.franchise_id,
      subjectType:
        cmd.kind === 'purchase'
          ? 'local_inward'
          : cmd.kind === 'count'
            ? 'stock_count'
            : 'wastage_event',
      subjectId: cmd.id,
      data: { employeeName, quantity: qty, reason: cmd.reason, expenseId },
    });
    await c.query(
      'update stock.employee_stock_entries set result=$2,completed_at=now() where id=$1',
      [cmd.id, JSON.stringify(result)],
    );
    return result;
  });
}
