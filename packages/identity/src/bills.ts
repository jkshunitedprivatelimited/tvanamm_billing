import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, BillView, CreateBillCommand } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit, recordOutbox } from './audit';
import { IdentityError } from './errors';
import { businessDate } from './membership';
import { calculateBill, type CalcLineInput } from './bill-calc';
import type { RequestMeta } from './admin-auth';

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

interface OutletRow {
  organization_id: string;
  franchise_id: string | null;
  timezone: string;
  status: string;
}

async function loadOutlet(client: PoolClient, outletId: string): Promise<OutletRow> {
  const { rows } = await client.query<OutletRow>(
    `select organization_id, franchise_id, timezone, status from billing.outlets where id = $1`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0];
}

function outletBusinessDate(timezone: string, now = new Date()): string {
  const d = businessDate(now, timezone);
  return `${String(d.year)}-${pad(d.month)}-${pad(d.day)}`;
}

interface SnapshotAddon {
  addonId: string;
  groupId: string;
  groupName: string;
  name: string;
  price: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  isAvailable: boolean;
}
interface SnapshotItem {
  catalogItemId: string;
  itemName: string;
  price: string;
  gstRate: string;
  isAvailable: boolean;
  stockRecipeId: string | null;
  stockRecipeVersion: number | null;
  addons: SnapshotAddon[];
}

async function loadMenuVersion(
  client: PoolClient,
  outletId: string,
  requestedVersion: string,
  offline: boolean,
): Promise<{ versionId: string; version: string; items: Map<string, SnapshotItem> }> {
  const cur = await client.query<{ id: string; version: string }>(
    `select id, version::text from billing.outlet_menu_versions
      where outlet_id = $1 and is_current`,
    [outletId],
  );
  if (!cur.rows[0]) throw new IdentityError('conflict', 'This outlet has no published menu');
  let versionId = cur.rows[0].id;
  let version = cur.rows[0].version;

  if (requestedVersion !== version) {
    if (!offline) {
      throw new IdentityError('conflict', 'The menu changed - reload before billing', {
        details: { code: 'menu_version_stale', currentVersion: version },
      });
    }
    const older = await client.query<{ id: string; version: string }>(
      `select id, version::text from billing.outlet_menu_versions where outlet_id = $1 and version = $2`,
      [outletId, requestedVersion],
    );
    if (!older.rows[0]) throw new IdentityError('conflict', 'Unknown menu version');
    versionId = older.rows[0].id;
    version = older.rows[0].version;
  }

  const rows = await client.query<{
    catalog_item_id: string;
    item_name: string;
    price: string;
    gst_rate: string;
    is_available: boolean;
    stock_recipe_id: string | null;
    stock_recipe_version: number | null;
    addons: SnapshotAddon[] | null;
  }>(
    `select catalog_item_id, item_name, price, gst_rate, is_available,
            stock_recipe_id, stock_recipe_version, addons
       from billing.outlet_menu_version_items where outlet_menu_version_id = $1`,
    [versionId],
  );
  const items = new Map<string, SnapshotItem>();
  for (const r of rows.rows) {
    items.set(r.catalog_item_id, {
      catalogItemId: r.catalog_item_id,
      itemName: r.item_name,
      price: r.price,
      gstRate: r.gst_rate,
      isAvailable: r.is_available,
      stockRecipeId: r.stock_recipe_id,
      stockRecipeVersion: r.stock_recipe_version,
      addons: r.addons ?? [],
    });
  }
  return { versionId, version, items };
}

interface ResolvedLine {
  lineNo: number;
  item: SnapshotItem;
  quantity: number;
  note: string | null;
  addons: { snap: SnapshotAddon; quantity: number }[];
  calc: CalcLineInput;
}

function resolveLines(cmd: CreateBillCommand, menu: Map<string, SnapshotItem>): ResolvedLine[] {
  return cmd.lines.map((line, i) => {
    const item = menu.get(line.catalogItemId);
    if (!item) throw new IdentityError('validation', `Item not on the published menu`);
    if (!item.isAvailable) {
      throw new IdentityError('conflict', `"${item.itemName}" is out of stock`, {
        details: { code: 'item_unavailable', catalogItemId: item.catalogItemId },
      });
    }
    const byGroup = new Map<string, number>();
    const addons = (line.addons ?? []).map((a) => {
      const snap = item.addons.find((x) => x.addonId === a.addonId);
      if (!snap) throw new IdentityError('validation', 'Add-on is not offered for this item');
      if (!snap.isAvailable) throw new IdentityError('conflict', 'Add-on is unavailable');
      byGroup.set(snap.groupId, (byGroup.get(snap.groupId) ?? 0) + a.quantity);
      return { snap, quantity: a.quantity };
    });
    // Enforce each add-on group's min / max selection rules.
    const groups = new Map(item.addons.map((x) => [x.groupId, x]));
    for (const g of groups.values()) {
      const picked = byGroup.get(g.groupId) ?? 0;
      if (g.isRequired && picked < Math.max(1, g.minSelect)) {
        throw new IdentityError(
          'validation',
          `Choose at least ${String(g.minSelect || 1)} from ${g.groupName}`,
        );
      }
      if (picked < g.minSelect) {
        throw new IdentityError(
          'validation',
          `Choose at least ${String(g.minSelect)} from ${g.groupName}`,
        );
      }
      if (picked > g.maxSelect) {
        throw new IdentityError(
          'validation',
          `Choose at most ${String(g.maxSelect)} from ${g.groupName}`,
        );
      }
    }
    return {
      lineNo: i + 1,
      item,
      quantity: line.quantity,
      note: line.note ?? null,
      addons,
      calc: {
        unitPrice: item.price,
        quantity: line.quantity,
        addons: addons.map((a) => ({ unitPrice: a.snap.price, quantity: a.quantity })),
        ...(line.lineDiscount
          ? { lineDiscount: { kind: line.lineDiscount.kind, value: line.lineDiscount.value } }
          : {}),
      },
    };
  });
}

async function allocateReceiptNumber(
  client: PoolClient,
  outletId: string,
  terminalId: string,
  businessDateStr: string,
): Promise<string> {
  const term = await client.query<{ receipt_prefix: string }>(
    `select receipt_prefix from identity.terminals where id = $1`,
    [terminalId],
  );
  const prefix = term.rows[0]?.receipt_prefix ?? 'T01';
  const seq = await client.query<{ last_seq: number }>(
    `insert into billing.receipt_sequences (outlet_id, terminal_id, business_date, prefix, last_seq)
     values ($1,$2,$3,$4,1)
     on conflict (outlet_id, terminal_id, business_date)
       do update set last_seq = billing.receipt_sequences.last_seq + 1
     returning last_seq`,
    [outletId, terminalId, businessDateStr, prefix],
  );
  const n = seq.rows[0]?.last_seq ?? 1;
  return `${businessDateStr.replace(/-/g, '')}-${prefix}-${pad(n, 6)}`;
}

export async function createBill(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateBillCommand,
  meta: RequestMeta = {},
): Promise<BillView> {
  if (actor.kind !== 'operator' || !actor.employeeId || !actor.outletId || !actor.terminalId) {
    throw new IdentityError('forbidden', 'A store operator session is required');
  }
  const outletId = actor.outletId;
  const employeeId = actor.employeeId;
  const terminalId = actor.terminalId;
  const correlationId = meta.correlationId ?? randomUUID();
  ensureAllowed(actor, 'billing.sale.create', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });

  return withActorContext(pool, contextForActor(actor), async (client) => {
    // 1. Idempotency: a retry returns the original bill untouched.
    const existing = await client.query<{ id: string }>(
      `select id from billing.bills where outlet_id = $1 and idempotency_key = $2`,
      [outletId, cmd.idempotencyKey],
    );
    if (existing.rows[0]) return loadBill(client, existing.rows[0].id);

    const outlet = await loadOutlet(client, outletId);
    if (outlet.status !== 'active') {
      throw new IdentityError('outlet_not_active', 'Outlet is not active');
    }
    const today = outletBusinessDate(outlet.timezone);

    // 2. Billing window: no open shift / cash session from an earlier day.
    const stale = await client.query(
      `select 1 from billing.cash_sessions
         where outlet_id = $1 and status = 'open' and business_date < $2
       union all
       select 1 from billing.employee_shifts
         where outlet_id = $1 and status = 'open' and business_date < $2 limit 1`,
      [outletId, today],
    );
    if (stale.rowCount) {
      throw new IdentityError('conflict', 'Close the previous day before billing', {
        details: { code: 'billing_window_closed' },
      });
    }

    // 3. An open cash session and the operator's own open shift are required.
    const cash = await client.query<{ id: string }>(
      `select id from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
      [outletId],
    );
    if (!cash.rows[0]) {
      throw new IdentityError('conflict', 'Open a cash session before billing', {
        details: { code: 'cash_session_required' },
      });
    }
    const shift = await client.query<{ id: string }>(
      `select id from billing.employee_shifts where employee_id = $1 and status = 'open'`,
      [employeeId],
    );
    if (!shift.rows[0]) {
      throw new IdentityError('conflict', 'Start your shift before billing', {
        details: { code: 'shift_required' },
      });
    }

    // 4. Authoritative pricing from the published menu version.
    const menu = await loadMenuVersion(client, outletId, cmd.menuVersion, cmd.offline ?? false);
    const resolved = resolveLines(cmd, menu.items);

    const calc = calculateBill({
      paymentMethod: cmd.paymentMethod,
      lines: resolved.map((l) => l.calc),
      ...(cmd.billDiscount
        ? { billDiscount: { kind: cmd.billDiscount.kind, value: cmd.billDiscount.value } }
        : {}),
    });

    if (!calc.isComplimentary && cmd.paymentMethod === null) {
      throw new IdentityError('validation', 'A payable bill needs a payment method');
    }

    // 5. Receipt number (offline devices supply a pre-allocated one).
    const receiptNumber =
      (cmd.offline ?? false) && cmd.terminalReceiptNumber
        ? cmd.terminalReceiptNumber
        : await allocateReceiptNumber(client, outletId, terminalId, today);

    // 6. Atomic write.
    const empName = await client.query<{ full_name: string }>(
      `select full_name from identity.store_employees where id = $1`,
      [employeeId],
    );
    const billId = randomUUID();
    try {
      await client.query(
        `insert into billing.bills
           (id, organization_id, franchise_id, outlet_id, terminal_id, employee_id, employee_name,
            shift_id, cash_session_id, receipt_number, business_date, menu_version,
            customer_name, customer_mobile, subtotal, discount_total, pre_round_total,
            round_adjustment, final_total, payment_method, is_complimentary, is_offline,
            idempotency_key, terminal_occurred_at, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          billId,
          outlet.organization_id,
          outlet.franchise_id,
          outletId,
          terminalId,
          employeeId,
          empName.rows[0]?.full_name ?? 'Employee',
          shift.rows[0].id,
          cash.rows[0].id,
          receiptNumber,
          today,
          menu.version,
          cmd.customer?.name ?? null,
          cmd.customer?.mobile ?? null,
          calc.subtotal,
          calc.discountTotal,
          calc.preRoundTotal,
          calc.roundAdjustment,
          calc.finalTotal,
          calc.isComplimentary ? null : cmd.paymentMethod,
          calc.isComplimentary,
          cmd.offline ?? false,
          cmd.idempotencyKey,
          cmd.terminalOccurredAt,
          correlationId,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const again = await client.query<{ id: string }>(
          `select id from billing.bills where outlet_id = $1 and idempotency_key = $2`,
          [outletId, cmd.idempotencyKey],
        );
        if (again.rows[0]) return loadBill(client, again.rows[0].id);
      }
      throw err;
    }

    for (const line of resolved) {
      const lineId = randomUUID();
      const lc = calc.lines[line.lineNo - 1];
      const cmdLine = cmd.lines[line.lineNo - 1];
      if (!lc) throw new IdentityError('validation', 'calculator/line mismatch');
      await client.query(
        `insert into billing.bill_lines
           (id, bill_id, line_no, catalog_item_id, item_name, quantity, unit_price, gst_rate,
            base_total, discount, final_total, note, stock_recipe_id, stock_recipe_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          lineId,
          billId,
          line.lineNo,
          line.item.catalogItemId,
          line.item.itemName,
          line.quantity,
          line.item.price,
          line.item.gstRate,
          lc.baseTotal,
          lc.discount,
          lc.finalTotal,
          line.note,
          line.item.stockRecipeId,
          line.item.stockRecipeVersion,
        ],
      );
      for (const a of line.addons) {
        const total = (Number(a.snap.price) * a.quantity).toFixed(2);
        await client.query(
          `insert into billing.bill_line_addons
             (bill_line_id, addon_id, addon_name, quantity, unit_price, total)
           values ($1,$2,$3,$4,$5,$6)`,
          [lineId, a.snap.addonId, a.snap.name, a.quantity, a.snap.price, total],
        );
      }
      if (cmdLine?.lineDiscount && Number(lc.discount) > 0) {
        const d = cmdLine.lineDiscount;
        await client.query(
          `insert into billing.bill_discounts
             (bill_id, bill_line_id, scope, kind, input_value, amount, reason)
           values ($1,$2,'line',$3,$4,$5,$6)`,
          [billId, lineId, d.kind, d.value, lc.discount, d.reason],
        );
      }
    }
    if (cmd.billDiscount && Number(calc.discountTotal) > 0) {
      const linesDisc = calc.lines.reduce((s, l) => s + Number(l.discount), 0);
      const billPart = (Number(calc.discountTotal) - linesDisc).toFixed(2);
      if (Number(billPart) > 0) {
        await client.query(
          `insert into billing.bill_discounts
             (bill_id, bill_line_id, scope, kind, input_value, amount, reason)
           values ($1,null,'bill',$2,$3,$4,$5)`,
          [
            billId,
            cmd.billDiscount.kind,
            cmd.billDiscount.value,
            billPart,
            cmd.billDiscount.reason,
          ],
        );
      }
    }

    if (!calc.isComplimentary && cmd.paymentMethod) {
      await client.query(
        `insert into billing.payments (bill_id, method, amount, round_adjustment, reference)
         values ($1,$2,$3,$4,$5)`,
        [
          billId,
          cmd.paymentMethod,
          calc.finalTotal,
          calc.roundAdjustment,
          cmd.paymentMethod === 'upi' ? (cmd.paymentReference ?? null) : null,
        ],
      );
    }

    await client.query(
      `update billing.employee_shifts set bill_count = bill_count + 1 where id = $1`,
      [shift.rows[0].id],
    );

    await recordAudit(client, {
      action: 'sale.created',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId,
      terminalId,
      correlationId,
      metadata: {
        billId,
        receiptNumber,
        finalTotal: calc.finalTotal,
        paymentMethod: calc.isComplimentary ? 'complimentary' : cmd.paymentMethod,
        lineCount: resolved.length,
      },
    });
    await recordOutbox(client, {
      eventType: 'SaleCompleted',
      aggregateId: billId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId,
      correlationId,
      idempotencyKey: `SaleCompleted:${billId}`,
      payload: {
        billId,
        outletId,
        receiptNumber,
        businessDate: today,
        finalTotal: calc.finalTotal,
        lines: resolved.map((l) => ({
          catalogItemId: l.item.catalogItemId,
          quantity: l.quantity,
          stockRecipeId: l.item.stockRecipeId,
          stockRecipeVersion: l.item.stockRecipeVersion,
          addons: l.addons.map((a) => ({ addonId: a.snap.addonId, quantity: a.quantity })),
        })),
      },
    });

    return loadBill(client, billId);
  });
}

async function loadBill(client: PoolClient, billId: string): Promise<BillView> {
  const b = await client.query<{
    id: string;
    outlet_id: string;
    receipt_number: string;
    business_date: Date;
    menu_version: string;
    employee_name: string;
    customer_name: string | null;
    customer_mobile: string | null;
    subtotal: string;
    discount_total: string;
    pre_round_total: string;
    round_adjustment: string;
    final_total: string;
    payment_method: BillView['paymentMethod'];
    is_complimentary: boolean;
    is_offline: boolean;
    committed_at: Date;
  }>(
    `select id, outlet_id, receipt_number, business_date, menu_version::text as menu_version,
            employee_name, customer_name, customer_mobile, subtotal, discount_total,
            pre_round_total, round_adjustment, final_total, payment_method, is_complimentary,
            is_offline, committed_at
       from billing.bills where id = $1`,
    [billId],
  );
  const row = b.rows[0];
  if (!row) throw new IdentityError('not_found', 'Bill not found');
  const lines = await client.query<{
    id: string;
    line_no: number;
    catalog_item_id: string;
    item_name: string;
    quantity: number;
    unit_price: string;
    gst_rate: string;
    base_total: string;
    discount: string;
    final_total: string;
    note: string | null;
  }>(
    `select id, line_no, catalog_item_id, item_name, quantity, unit_price, gst_rate,
            base_total, discount, final_total, note
       from billing.bill_lines where bill_id = $1 order by line_no`,
    [billId],
  );
  const addons = await client.query<{
    bill_line_id: string;
    addon_id: string;
    addon_name: string;
    quantity: number;
    unit_price: string;
    total: string;
  }>(
    `select bill_line_id, addon_id, addon_name, quantity, unit_price, total
       from billing.bill_line_addons where bill_line_id = any($1::uuid[])`,
    [lines.rows.map((l) => l.id)],
  );
  const pay = await client.query<{ reference: string | null }>(
    `select reference from billing.payments where bill_id = $1`,
    [billId],
  );
  return {
    id: row.id,
    outletId: row.outlet_id,
    receiptNumber: row.receipt_number,
    businessDate: row.business_date.toISOString().slice(0, 10),
    menuVersion: row.menu_version,
    employeeName: row.employee_name,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    preRoundTotal: row.pre_round_total,
    roundAdjustment: row.round_adjustment,
    finalTotal: row.final_total,
    paymentMethod: row.payment_method,
    paymentReference: pay.rows[0]?.reference ?? null,
    isComplimentary: row.is_complimentary,
    isOffline: row.is_offline,
    committedAt: row.committed_at.toISOString(),
    lines: lines.rows.map((l) => ({
      lineNo: l.line_no,
      catalogItemId: l.catalog_item_id,
      itemName: l.item_name,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      gstRate: l.gst_rate,
      baseTotal: l.base_total,
      discount: l.discount,
      finalTotal: l.final_total,
      note: l.note,
      addons: addons.rows
        .filter((a) => a.bill_line_id === l.id)
        .map((a) => ({
          addonId: a.addon_id,
          addonName: a.addon_name,
          quantity: a.quantity,
          unitPrice: a.unit_price,
          total: a.total,
        })),
    })),
  };
}

export async function getBill(pool: Pool, actor: ActorContext, billId: string): Promise<BillView> {
  return withActorContext(pool, contextForActor(actor), (client) => loadBill(client, billId));
}

export interface BillListRow {
  id: string;
  receiptNumber: string;
  businessDate: string;
  finalTotal: string;
  paymentMethod: string | null;
  isComplimentary: boolean;
  committedAt: string;
}

export async function listBills(
  pool: Pool,
  actor: ActorContext,
  opts: { outletId: string; businessDate?: string; cursor?: string; limit?: number },
): Promise<{ bills: BillListRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const params: unknown[] = [opts.outletId];
    let where = `outlet_id = $1`;
    if (opts.businessDate) {
      params.push(opts.businessDate);
      where += ` and business_date = $${String(params.length)}`;
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      where += ` and committed_at < $${String(params.length)}`;
    }
    params.push(limit + 1);
    const { rows } = await client.query<{
      id: string;
      receipt_number: string;
      business_date: Date;
      final_total: string;
      payment_method: string | null;
      is_complimentary: boolean;
      committed_at: Date;
    }>(
      `select id, receipt_number, business_date, final_total, payment_method, is_complimentary,
              committed_at
         from billing.bills where ${where}
        order by committed_at desc limit $${String(params.length)}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      bills: page.map((r) => ({
        id: r.id,
        receiptNumber: r.receipt_number,
        businessDate: r.business_date.toISOString().slice(0, 10),
        finalTotal: r.final_total,
        paymentMethod: r.payment_method,
        isComplimentary: r.is_complimentary,
        committedAt: r.committed_at.toISOString(),
      })),
      nextCursor:
        rows.length > limit ? (page[page.length - 1]?.committed_at.toISOString() ?? null) : null,
    };
  });
}
