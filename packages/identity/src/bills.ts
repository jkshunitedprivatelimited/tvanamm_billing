import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, BillView, CreateBillCommand } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit, recordOutbox } from './audit';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import { calculateBill, type CalcLineInput } from './bill-calc';
import {
  parseOfflineAuthBundle,
  assertOfflineAuthCovers,
  type DiscountPolicy,
} from './offline-auth';
import { identityTokenSecret } from '@jksh/config';
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
): Promise<{
  versionId: string;
  version: string;
  checksum: string;
  items: Map<string, SnapshotItem>;
}> {
  const cur = await client.query<{ id: string; version: string; checksum: string }>(
    `select id, version::text, checksum from billing.outlet_menu_versions
      where outlet_id = $1 and is_current`,
    [outletId],
  );
  if (!cur.rows[0]) throw new IdentityError('conflict', 'This outlet has no published menu');
  let versionId = cur.rows[0].id;
  let version = cur.rows[0].version;
  let checksum = cur.rows[0].checksum;

  if (requestedVersion !== version) {
    if (!offline) {
      throw new IdentityError('conflict', 'The menu changed - reload before billing', {
        details: { code: 'menu_version_stale', currentVersion: version },
      });
    }
    const older = await client.query<{ id: string; version: string; checksum: string }>(
      `select id, version::text, checksum from billing.outlet_menu_versions
        where outlet_id = $1 and version = $2`,
      [outletId, requestedVersion],
    );
    if (!older.rows[0]) throw new IdentityError('conflict', 'Unknown menu version');
    versionId = older.rows[0].id;
    version = older.rows[0].version;
    checksum = older.rows[0].checksum;
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
  // A pause (`catalog.item.pause`) is a live override, never a republish - an
  // online sale must honor it immediately. An offline sale trusts exactly the
  // signed snapshot it was authorized against instead
  // (`offline-billing.md` "Menu changes do not invalidate already-created
  // offline bills if their signed snapshot was valid").
  const liveAvailability = offline
    ? new Map<string, { is_available: boolean }>()
    : new Map(
        (
          await client.query<{ catalog_item_id: string; is_available: boolean }>(
            `select ci.id as catalog_item_id, coalesce(o.is_available, ci.is_available) as is_available
               from billing.catalog_items ci
               left join billing.outlet_item_overrides o
                 on o.catalog_item_id = ci.id and o.outlet_id = $1
              where ci.id = any($2::uuid[])`,
            [outletId, rows.rows.map((r) => r.catalog_item_id)],
          )
        ).rows.map((r) => [r.catalog_item_id, r]),
      );
  const items = new Map<string, SnapshotItem>();
  for (const r of rows.rows) {
    items.set(r.catalog_item_id, {
      catalogItemId: r.catalog_item_id,
      itemName: r.item_name,
      price: r.price,
      gstRate: r.gst_rate,
      isAvailable: liveAvailability.get(r.catalog_item_id)?.is_available ?? r.is_available,
      stockRecipeId: r.stock_recipe_id,
      stockRecipeVersion: r.stock_recipe_version,
      addons: r.addons ?? [],
    });
  }
  return { versionId, version, checksum, items };
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

/** Receipt prefix for a terminal (MVP: one active terminal per outlet, always
 *  "T01" - kept a lookup rather than a constant so multi-terminal support only
 *  needs to change `identity.terminals.receipt_prefix`, never this call site). */
async function terminalPrefix(client: PoolClient, terminalId: string): Promise<string> {
  const { rows } = await client.query<{ receipt_prefix: string }>(
    `select receipt_prefix from identity.terminals where id = $1`,
    [terminalId],
  );
  return rows[0]?.receipt_prefix ?? 'T01';
}

export function formatReceiptNumber(businessDateStr: string, prefix: string, seq: number): string {
  return `${businessDateStr.replace(/-/g, '')}-${prefix}-${pad(seq, 6)}`;
}

/**
 * The counter is keyed by (outlet, PREFIX, business date) rather than by
 * terminal id: replacing a revoked terminal reissues the same prefix
 * (`identity.terminals_outlet_prefix_active`), and the sequence must continue
 * from where the old device left off rather than restart and collide with
 * numbers it already printed (`docs/architecture/offline-billing.md`
 * "Reinstall/re-enrollment cannot reuse unconfirmed receipt-number allocations").
 */
async function allocateReceiptNumber(
  client: PoolClient,
  outletId: string,
  terminalId: string,
  businessDateStr: string,
): Promise<string> {
  const prefix = await terminalPrefix(client, terminalId);
  const seq = await client.query<{ last_seq: number }>(
    `insert into billing.receipt_sequences (outlet_id, prefix, business_date, last_seq, last_terminal_id)
     values ($1,$2,$3,1,$4)
     on conflict (outlet_id, prefix, business_date)
       do update set last_seq = billing.receipt_sequences.last_seq + 1, last_terminal_id = $4
     returning last_seq`,
    [outletId, prefix, businessDateStr, terminalId],
  );
  const n = seq.rows[0]?.last_seq ?? 1;
  return formatReceiptNumber(businessDateStr, prefix, n);
}

/** An offline device's pre-allocated receipt number must fall inside one of
 *  this outlet's active receipt reservations - proving the block was really
 *  reserved server-side rather than a client just formatting a plausible
 *  string (`offline-billing.md` "insufficient receipt-number allocation
 *  blocks new offline bills before a collision can occur"). */
async function assertReceiptNumberReserved(
  client: PoolClient,
  outletId: string,
  receiptNumber: string,
): Promise<void> {
  const match = /^(\d{8})-(T\d{2})-(\d{6})$/.exec(receiptNumber);
  if (!match) throw new IdentityError('validation', 'Malformed receipt number');
  const [, dateDigits, prefix, seqDigits] = match as unknown as [string, string, string, string];
  const businessDateStr = `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}`;
  const seq = Number(seqDigits);
  const { rowCount } = await client.query(
    `select 1 from billing.receipt_reservations
      where outlet_id = $1 and prefix = $2 and business_date = $3
        and start_seq <= $4 and end_seq >= $4`,
    [outletId, prefix, businessDateStr, seq],
  );
  if (!rowCount) {
    throw new IdentityError('conflict', 'Receipt number was not reserved for this outlet', {
      details: { code: 'receipt_not_reserved' },
    });
  }
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
  if (cmd.billDiscount || cmd.lines.some((l) => l.lineDiscount)) {
    ensureAllowed(actor, 'billing.discount.apply', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId,
    });
  }

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
    const today = businessDateString(new Date(), outlet.timezone);

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

    // 4a. Offline bills must present a valid, matching authorization bundle.
    let discountCeiling: DiscountPolicy | null = null;
    if (cmd.offline) {
      if (!cmd.offlineAuthBundle) {
        throw new IdentityError('offline_auth_invalid', 'Offline authorization is required');
      }
      const bundle = parseOfflineAuthBundle(identityTokenSecret(), cmd.offlineAuthBundle);
      if (!bundle) {
        throw new IdentityError('offline_auth_invalid', 'Offline authorization is not valid');
      }
      const covers = assertOfflineAuthCovers(bundle, {
        outletId,
        terminalId,
        employeeId,
        menuVersion: menu.version,
        menuChecksum: menu.checksum,
        terminalOccurredAt: cmd.terminalOccurredAt,
      });
      if (!covers.ok) throw new IdentityError('offline_auth_invalid', covers.reason);
      discountCeiling = bundle.discountPolicy;
    }

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

    // 4b. Offline discounts are capped by the bundle's policy (no live
    // oversight is possible while disconnected).
    if (discountCeiling) {
      const maxLine = Number(discountCeiling.maxLineDiscountPercent);
      const maxBill = Number(discountCeiling.maxBillDiscountPercent);
      for (const l of calc.lines) {
        if (
          Number(l.baseTotal) > 0 &&
          (Number(l.discount) / Number(l.baseTotal)) * 100 > maxLine + 1e-9
        ) {
          throw new IdentityError('conflict', 'Line discount exceeds the offline limit', {
            details: { code: 'discount_ceiling_exceeded', maxLineDiscountPercent: maxLine },
          });
        }
      }
      if (
        Number(calc.subtotal) > 0 &&
        (Number(calc.discountTotal) / Number(calc.subtotal)) * 100 > maxBill + 1e-9
      ) {
        throw new IdentityError('conflict', 'Bill discount exceeds the offline limit', {
          details: { code: 'discount_ceiling_exceeded', maxBillDiscountPercent: maxBill },
        });
      }
    }

    // 5. Receipt number. Offline devices supply one pre-allocated from their
    // own reserved block; the server confirms it actually falls inside an
    // active reservation for this outlet before trusting it.
    let receiptNumber: string;
    if (cmd.offline && cmd.terminalReceiptNumber) {
      await assertReceiptNumberReserved(client, outletId, cmd.terminalReceiptNumber);
      receiptNumber = cmd.terminalReceiptNumber;
    } else {
      receiptNumber = await allocateReceiptNumber(client, outletId, terminalId, today);
    }

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
    business_date: string;
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
    // business_date is cast to text: a `date` column parsed as a JS Date and
    // then re-serialized with toISOString() shifts a day backward whenever
    // the server process runs in a timezone ahead of UTC (dates carry no
    // time-of-day to convert).
    `select id, outlet_id, receipt_number, business_date::text as business_date,
            menu_version::text as menu_version,
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
  const refundedByLine = await client.query<{ bill_line_id: string; qty: string }>(
    `select bl.id as bill_line_id, coalesce(sum(rl.quantity), 0) as qty
       from billing.bill_lines bl
       left join billing.refund_lines rl on rl.bill_line_id = bl.id
      where bl.bill_id = $1
      group by bl.id`,
    [billId],
  );
  const refundedQtyById = new Map(refundedByLine.rows.map((r) => [r.bill_line_id, Number(r.qty)]));
  const refundedTotal = await client.query<{ total: string }>(
    `select coalesce(sum(amount), 0) as total from billing.refunds where bill_id = $1`,
    [billId],
  );
  const refundedSoFar = Number(refundedTotal.rows[0]?.total ?? '0');
  const remainingRefundablePaise = Math.max(
    Math.round(Number(row.final_total) * 100) - Math.round(refundedSoFar * 100),
    0,
  );
  const remainingRefundable = `${String(Math.floor(remainingRefundablePaise / 100))}.${String(remainingRefundablePaise % 100).padStart(2, '0')}`;
  // A zero-total complimentary bill has remainingRefundable = 0 too, but that
  // is not the same as "fully refunded" - check whether anything was actually
  // refunded first.
  const anyRefunded = refundedSoFar > 0;
  const status: BillView['status'] = !anyRefunded
    ? 'completed'
    : remainingRefundablePaise === 0
      ? 'fully_refunded'
      : 'partially_refunded';
  return {
    id: row.id,
    outletId: row.outlet_id,
    receiptNumber: row.receipt_number,
    businessDate: row.business_date,
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
    status,
    remainingRefundable,
    lines: lines.rows.map((l) => ({
      id: l.id,
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
      refundedQuantity: refundedQtyById.get(l.id) ?? 0,
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
    // A Store Employee's history is always the current outlet-local business
    // date, regardless of what was requested - never a prior date
    // (`billing-history-refunds.md` "cannot browse previous business dates").
    let businessDate = opts.businessDate;
    if (actor.kind === 'operator') {
      const outlet = await client.query<{ timezone: string }>(
        `select timezone from billing.outlets where id = $1`,
        [opts.outletId],
      );
      businessDate = businessDateString(new Date(), outlet.rows[0]?.timezone ?? 'Asia/Kolkata');
    }
    if (businessDate) {
      params.push(businessDate);
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
      business_date: string;
      final_total: string;
      payment_method: string | null;
      is_complimentary: boolean;
      committed_at: Date;
    }>(
      `select id, receipt_number, business_date::text as business_date, final_total,
              payment_method, is_complimentary, committed_at
         from billing.bills where ${where}
        order by committed_at desc limit $${String(params.length)}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      bills: page.map((r) => ({
        id: r.id,
        receiptNumber: r.receipt_number,
        businessDate: r.business_date,
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
