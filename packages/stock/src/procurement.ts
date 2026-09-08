import { randomUUID } from 'node:crypto';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import {
  assertWarehouseAccess,
  ensureStockAllowed,
  stockContextForActor,
  type StockActor,
} from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { postMovement } from './ledger';

// ---- Suppliers -------------------------------------------------------

export interface CreateSupplierCommand {
  organizationId: string;
  name: string;
  gstin?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  paymentTermsDays?: number;
}

export async function createSupplier(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateSupplierCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.suppliers
         (organization_id, name, gstin, contact_name, contact_phone, contact_email,
          payment_terms_days, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.name,
        cmd.gstin ?? null,
        cmd.contactName ?? null,
        cmd.contactPhone ?? null,
        cmd.contactEmail ?? null,
        cmd.paymentTermsDays ?? 0,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'supplier').id };
  });
}

export async function approveSupplier(
  pool: StockPool,
  actor: StockActor,
  supplierId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query('update stock.suppliers set is_approved = true where id = $1', [
      supplierId,
    ]);
    if (!r.rowCount) throw new StockError('not_found', 'Supplier not found');
    await recordStockAudit(client, {
      action: 'supplier.approved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      subjectType: 'supplier',
      subjectId: supplierId,
    });
  });
}

// ---- Purchase orders ----------------------------------------------

export interface PurchaseOrderLineInput {
  itemId: string;
  orderQtyBase: string;
  unitPricePaise: number;
  gstRate?: string | number;
}

export interface CreatePurchaseOrderCommand {
  organizationId: string;
  supplierId: string;
  warehouseId: string;
  poNumber: string;
  expectedDate?: string | null;
  lines: PurchaseOrderLineInput[];
}

export async function createPurchaseOrder(
  pool: StockPool,
  actor: StockActor,
  cmd: CreatePurchaseOrderCommand,
): Promise<{ id: string; totalPaise: number }> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  assertWarehouseAccess(actor, cmd.warehouseId);
  if (cmd.lines.length === 0) throw new StockError('validation', 'A purchase order needs a line');

  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const supplier = await client.query<{ is_approved: boolean }>(
      'select is_approved from stock.suppliers where id = $1 and organization_id = $2',
      [cmd.supplierId, cmd.organizationId],
    );
    if (!supplier.rows[0]) throw new StockError('not_found', 'Supplier not found');
    if (!supplier.rows[0].is_approved) {
      throw new StockError('forbidden', 'Supplier is not approved');
    }
    const wh = await client.query(
      'select 1 from stock.warehouses where id = $1 and organization_id = $2',
      [cmd.warehouseId, cmd.organizationId],
    );
    if (!wh.rowCount) throw new StockError('validation', 'Warehouse is outside this organization');

    let subtotal = 0;
    let tax = 0;
    for (const line of cmd.lines) {
      const lineNet = Math.round(Number(line.orderQtyBase) * line.unitPricePaise);
      const gst = Number(line.gstRate ?? 0);
      subtotal += lineNet;
      tax += Math.round((lineNet * gst) / 100);
    }
    const total = subtotal + tax;

    const po = await client.query<{ id: string }>(
      `insert into stock.purchase_orders
         (organization_id, supplier_id, warehouse_id, po_number, expected_date,
          subtotal_paise, tax_paise, total_paise, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        cmd.organizationId,
        cmd.supplierId,
        cmd.warehouseId,
        cmd.poNumber,
        cmd.expectedDate ?? null,
        subtotal,
        tax,
        total,
        actor.accountId ?? null,
      ],
    );
    const poId = requireRow(po, 'purchase order').id;
    for (const line of cmd.lines) {
      await client.query(
        `insert into stock.purchase_order_lines
           (purchase_order_id, item_id, order_qty_base, unit_price_paise, gst_rate)
         values ($1,$2,$3,$4,$5)`,
        [poId, line.itemId, line.orderQtyBase, line.unitPricePaise, String(line.gstRate ?? 0)],
      );
    }
    await recordStockAudit(client, {
      action: 'purchase_order.created',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      warehouseId: cmd.warehouseId,
      subjectType: 'purchase_order',
      subjectId: poId,
      data: { poNumber: cmd.poNumber, totalPaise: total },
    });
    return { id: poId, totalPaise: total };
  });
}

const PO_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  submit: { from: ['draft'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  order: { from: ['approved'], to: 'ordered' },
  close: { from: ['received', 'partially_received'], to: 'closed' },
  cancel: { from: ['draft', 'submitted', 'approved'], to: 'cancelled' },
};

export async function transitionPurchaseOrder(
  pool: StockPool,
  actor: StockActor,
  poId: string,
  action: keyof typeof PO_TRANSITIONS,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  const rule = PO_TRANSITIONS[action];
  if (!rule) throw new StockError('validation', `Unknown transition: ${action}`);

  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const po = await client.query<{ status: string }>(
      'select status from stock.purchase_orders where id = $1',
      [poId],
    );
    const current = po.rows[0];
    if (!current) throw new StockError('not_found', 'Purchase order not found');
    if (!rule.from.includes(current.status)) {
      throw new StockError('conflict', `Cannot ${action} a ${current.status} purchase order`);
    }
    const stamp =
      action === 'approve'
        ? ', approved_by = $3, approved_at = now()'
        : action === 'submit'
          ? ', submitted_by = $3'
          : '';
    await client.query(
      `update stock.purchase_orders set status = $2${stamp} where id = $1`,
      stamp ? [poId, rule.to, actor.accountId ?? null] : [poId, rule.to],
    );
    await recordStockAudit(client, {
      action: `purchase_order.${action}`,
      actorRequest: actor.request,
      accountId: actor.accountId,
      subjectType: 'purchase_order',
      subjectId: poId,
    });
    return { status: rule.to };
  });
}

// ---- Receiving ---------------------------------------------------

export interface ReceiptLineInput {
  purchaseOrderLineId?: string | null;
  itemId: string;
  batchCode?: string | null;
  manufactureDate?: string | null;
  expiryDate?: string | null;
  acceptedQtyBase: string;
  damagedQtyBase?: string;
  rejectedQtyBase?: string;
  unitCostPaise: number;
  manualEntryReason?: string | null;
}

export interface ReceiveShipmentCommand {
  organizationId: string;
  purchaseOrderId: string;
  warehouseId: string;
  receiptNumber: string;
  idempotencyKey: string;
  supplierInvoiceNumber?: string | null;
  invoiceDate?: string | null;
  landedCosts?: Record<string, unknown>;
  lines: ReceiptLineInput[];
}

export interface ReceiveShipmentResult {
  receiptId: string;
  status: 'draft' | 'quarantined' | 'posted';
  duplicate: boolean;
  poStatus: string;
}

/**
 * Record a supplier receipt against a PO. Without a supplier invoice number the
 * receipt stays a draft and posts nothing. With one, accepted quantity posts to
 * the warehouse sellable location and damaged quantity to the damaged location;
 * rejected quantity never enters stock. Duplicate commands are idempotent on
 * (organization_id, idempotency_key).
 */
export async function receiveSupplierShipment(
  pool: StockPool,
  actor: StockActor,
  cmd: ReceiveShipmentCommand,
): Promise<ReceiveShipmentResult> {
  ensureStockAllowed(actor, 'stock.receiving.operate');
  assertWarehouseAccess(actor, cmd.warehouseId);
  if (cmd.lines.length === 0) throw new StockError('validation', 'A receipt needs a line');

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const existing = await client.query<{ id: string; status: string }>(
      `select id, status from stock.supplier_receipts
        where organization_id = $1 and idempotency_key = $2`,
      [cmd.organizationId, cmd.idempotencyKey],
    );
    if (existing.rows[0]) {
      const poRow = await client.query<{ status: string }>(
        'select status from stock.purchase_orders where id = $1',
        [cmd.purchaseOrderId],
      );
      return {
        receiptId: existing.rows[0].id,
        status: existing.rows[0].status as ReceiveShipmentResult['status'],
        duplicate: true,
        poStatus: poRow.rows[0]?.status ?? 'unknown',
      };
    }

    const locs = await client.query<{ kind: string; id: string }>(
      `select kind::text as kind, id from stock.stock_locations
        where warehouse_id = $1 and scope = 'warehouse' and kind in ('sellable','damaged')`,
      [cmd.warehouseId],
    );
    const sellable = locs.rows.find((r) => r.kind === 'sellable')?.id;
    const damaged = locs.rows.find((r) => r.kind === 'damaged')?.id;
    if (!sellable || !damaged) throw new StockError('not_found', 'Warehouse locations missing');

    const hasInvoice = !!cmd.supplierInvoiceNumber && cmd.supplierInvoiceNumber.trim().length > 0;
    const status: ReceiveShipmentResult['status'] = hasInvoice ? 'posted' : 'draft';

    const po = await client.query<{
      supplier_id: string;
      warehouse_id: string;
      organization_id: string;
    }>(
      'select supplier_id, warehouse_id, organization_id from stock.purchase_orders where id = $1',
      [cmd.purchaseOrderId],
    );
    if (!po.rows[0]) throw new StockError('not_found', 'Purchase order not found');
    if (
      po.rows[0].organization_id !== cmd.organizationId ||
      po.rows[0].warehouse_id !== cmd.warehouseId
    ) {
      throw new StockError(
        'validation',
        'Receipt does not match the purchase order warehouse / org',
      );
    }

    const receiptId = randomUUID();
    await client.query(
      `insert into stock.supplier_receipts
         (id, organization_id, purchase_order_id, warehouse_id, supplier_id, receipt_number,
          supplier_invoice_number, invoice_date, landed_costs, status, idempotency_key,
          received_by, posted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        receiptId,
        cmd.organizationId,
        cmd.purchaseOrderId,
        cmd.warehouseId,
        po.rows[0].supplier_id,
        cmd.receiptNumber,
        cmd.supplierInvoiceNumber ?? null,
        cmd.invoiceDate ?? null,
        JSON.stringify(cmd.landedCosts ?? {}),
        status,
        cmd.idempotencyKey,
        actor.accountId ?? null,
        status === 'posted' ? new Date().toISOString() : null,
      ],
    );

    for (const [index, line] of cmd.lines.entries()) {
      const accepted = Number(line.acceptedQtyBase);
      const damagedQty = Number(line.damagedQtyBase ?? '0');
      const rejectedQty = Number(line.rejectedQtyBase ?? '0');
      await client.query(
        `insert into stock.supplier_receipt_lines
           (supplier_receipt_id, purchase_order_line_id, item_id, batch_code, manufacture_date,
            expiry_date, accepted_qty_base, damaged_qty_base, rejected_qty_base, unit_cost_paise,
            manual_entry_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          receiptId,
          line.purchaseOrderLineId ?? null,
          line.itemId,
          line.batchCode ?? null,
          line.manufactureDate ?? null,
          line.expiryDate ?? null,
          accepted.toFixed(6),
          damagedQty.toFixed(6),
          rejectedQty.toFixed(6),
          line.unitCostPaise,
          line.manualEntryReason ?? null,
        ],
      );

      if (status !== 'posted') continue;

      let batchId: string | null = null;
      if (line.batchCode) {
        const b = await client.query<{ id: string }>(
          `insert into stock.batches
             (organization_id, item_id, batch_code, manufacture_date, expiry_date, origin)
           values ($1,$2,$3,$4,$5,'received')
           on conflict (item_id, batch_code) do update set expiry_date = excluded.expiry_date
           returning id`,
          [
            cmd.organizationId,
            line.itemId,
            line.batchCode,
            line.manufactureDate ?? null,
            line.expiryDate ?? null,
          ],
        );
        batchId = requireRow(b, 'batch').id;
      }

      if (accepted > 0) {
        await postMovement(client, {
          organizationId: cmd.organizationId,
          stockLocationId: sellable,
          itemId: line.itemId,
          batchId,
          quantity: accepted.toFixed(6),
          movementType: 'receipt',
          unitCostPaise: line.unitCostPaise,
          sourceDocType: 'supplier_receipt',
          sourceDocId: receiptId,
          idempotencyKey: `receipt:${receiptId}:${String(index)}:accepted`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
      }
      if (damagedQty > 0) {
        await postMovement(client, {
          organizationId: cmd.organizationId,
          stockLocationId: damaged,
          itemId: line.itemId,
          batchId,
          quantity: damagedQty.toFixed(6),
          movementType: 'receipt',
          unitCostPaise: line.unitCostPaise,
          sourceDocType: 'supplier_receipt',
          sourceDocId: receiptId,
          idempotencyKey: `receipt:${receiptId}:${String(index)}:damaged`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
          notes: 'received damaged',
        });
      }

      if (line.purchaseOrderLineId) {
        await client.query(
          `update stock.purchase_order_lines
              set received_qty_base = received_qty_base + $2
            where id = $1`,
          [line.purchaseOrderLineId, (accepted + damagedQty).toFixed(6)],
        );
      }
    }

    let poStatus = (
      await client.query<{ status: string }>(
        'select status from stock.purchase_orders where id = $1',
        [cmd.purchaseOrderId],
      )
    ).rows[0]?.status;

    if (status === 'posted') {
      const progress = await client.query<{ outstanding: string }>(
        `select coalesce(sum(greatest(order_qty_base - received_qty_base, 0)), 0) as outstanding
           from stock.purchase_order_lines where purchase_order_id = $1`,
        [cmd.purchaseOrderId],
      );
      const nextStatus =
        Number(progress.rows[0]?.outstanding ?? '0') <= 0 ? 'received' : 'partially_received';
      await client.query('update stock.purchase_orders set status = $2 where id = $1', [
        cmd.purchaseOrderId,
        nextStatus,
      ]);
      poStatus = nextStatus;
    }

    await recordStockAudit(client, {
      action: 'supplier_receipt.recorded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      warehouseId: cmd.warehouseId,
      subjectType: 'supplier_receipt',
      subjectId: receiptId,
      data: { status, hasInvoice, lineCount: cmd.lines.length },
    });

    return { receiptId, status, duplicate: false, poStatus: poStatus ?? 'unknown' };
  });
}

// ---- Supplier invoices + payments -------------------------------

export interface CreateSupplierInvoiceCommand {
  organizationId: string;
  supplierId: string;
  supplierReceiptId?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  amountPaise: number;
}

export async function createSupplierInvoice(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateSupplierInvoiceCommand,
): Promise<{ id: string }> {
  if (actor.request !== 'system' && !['central_admin', 'accountant'].includes(actor.role)) {
    throw new StockError('forbidden', 'Only Central Admin or Accountant records supplier invoices');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.supplier_invoices
         (organization_id, supplier_id, supplier_receipt_id, invoice_number, invoice_date,
          due_date, amount_paise, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.supplierId,
        cmd.supplierReceiptId ?? null,
        cmd.invoiceNumber,
        cmd.invoiceDate,
        cmd.dueDate ?? null,
        cmd.amountPaise,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'supplier invoice').id };
  });
}

export interface RecordSupplierPaymentCommand {
  organizationId: string;
  supplierInvoiceId: string;
  amountPaise: number;
  method: 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'adjustment' | 'credit_note';
  reference?: string | null;
  paidOn: string;
}

export async function recordSupplierPayment(
  pool: StockPool,
  actor: StockActor,
  cmd: RecordSupplierPaymentCommand,
): Promise<{ id: string; state: string }> {
  ensureStockAllowed(actor, 'stock.supplier_payment.record');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const inv = await client.query('select 1 from stock.supplier_invoices where id = $1', [
      cmd.supplierInvoiceId,
    ]);
    if (!inv.rowCount) throw new StockError('not_found', 'Supplier invoice not found');
    const ins = await client.query<{ id: string }>(
      `insert into stock.supplier_payments
         (organization_id, supplier_invoice_id, amount_paise, method, reference, paid_on, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        cmd.organizationId,
        cmd.supplierInvoiceId,
        cmd.amountPaise,
        cmd.method,
        cmd.reference ?? null,
        cmd.paidOn,
        actor.accountId ?? null,
      ],
    );
    const state = await client.query<{ state: string }>(
      `select stock.supplier_invoice_state(i.*) as state
         from stock.supplier_invoices i where i.id = $1`,
      [cmd.supplierInvoiceId],
    );
    await recordStockAudit(client, {
      action: 'supplier_payment.recorded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      subjectType: 'supplier_invoice',
      subjectId: cmd.supplierInvoiceId,
      data: { amountPaise: cmd.amountPaise, method: cmd.method },
    });
    return { id: requireRow(ins, 'payment').id, state: state.rows[0]?.state ?? 'unpaid' };
  });
}

export async function getSupplierInvoice(
  pool: StockPool,
  actor: StockActor,
  invoiceId: string,
): Promise<{
  id: string;
  invoiceNumber: string;
  amountPaise: number;
  paidPaise: number;
  state: string;
}> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      invoice_number: string;
      amount_paise: string;
      paid_paise: string;
      state: string;
    }>(
      `select i.id, i.invoice_number, i.amount_paise,
              coalesce((select sum(amount_paise) from stock.supplier_payments p
                         where p.supplier_invoice_id = i.id), 0) as paid_paise,
              stock.supplier_invoice_state(i.*) as state
         from stock.supplier_invoices i where i.id = $1`,
      [invoiceId],
    );
    const row = rows[0];
    if (!row) throw new StockError('not_found', 'Supplier invoice not found');
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      amountPaise: Number(row.amount_paise),
      paidPaise: Number(row.paid_paise),
      state: row.state,
    };
  });
}

// ---- Supplier returns -----------------------------------------

export interface InitiateSupplierReturnCommand {
  organizationId: string;
  supplierId: string;
  warehouseId: string;
  itemId: string;
  batchId?: string | null;
  quantityBase: string;
  reason: 'damaged' | 'wrong_item' | 'expired' | 'rejected' | 'quality_failed';
  purchaseOrderId?: string | null;
  supplierReceiptId?: string | null;
  supplierInvoiceId?: string | null;
  evidenceUrl?: string | null;
}

export async function initiateSupplierReturn(
  pool: StockPool,
  actor: StockActor,
  cmd: InitiateSupplierReturnCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.receiving.operate');
  assertWarehouseAccess(actor, cmd.warehouseId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const locs = await client.query<{ kind: string; id: string }>(
      `select kind::text as kind, id from stock.stock_locations
        where warehouse_id = $1 and scope = 'warehouse' and kind in ('sellable','quarantine')`,
      [cmd.warehouseId],
    );
    const sellable = locs.rows.find((r) => r.kind === 'sellable')?.id;
    const quarantine = locs.rows.find((r) => r.kind === 'quarantine')?.id;
    if (!sellable || !quarantine) throw new StockError('not_found', 'Warehouse locations missing');

    const id = randomUUID();
    await client.query(
      `insert into stock.supplier_returns
         (id, organization_id, supplier_id, purchase_order_id, supplier_receipt_id,
          supplier_invoice_id, warehouse_id, item_id, batch_id, quantity_base, reason,
          evidence_url, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        cmd.organizationId,
        cmd.supplierId,
        cmd.purchaseOrderId ?? null,
        cmd.supplierReceiptId ?? null,
        cmd.supplierInvoiceId ?? null,
        cmd.warehouseId,
        cmd.itemId,
        cmd.batchId ?? null,
        cmd.quantityBase,
        cmd.reason,
        cmd.evidenceUrl ?? null,
        actor.accountId ?? null,
      ],
    );
    // Eligible quantity moves out of sellable into quarantine.
    await postMovement(client, {
      organizationId: cmd.organizationId,
      stockLocationId: sellable,
      itemId: cmd.itemId,
      batchId: cmd.batchId ?? null,
      quantity: (-Number(cmd.quantityBase)).toFixed(6),
      movementType: 'transfer_out',
      sourceDocType: 'supplier_return',
      sourceDocId: id,
      idempotencyKey: `supplier_return:${id}:out`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
    });
    await postMovement(client, {
      organizationId: cmd.organizationId,
      stockLocationId: quarantine,
      itemId: cmd.itemId,
      batchId: cmd.batchId ?? null,
      quantity: Number(cmd.quantityBase).toFixed(6),
      movementType: 'transfer_in',
      sourceDocType: 'supplier_return',
      sourceDocId: id,
      idempotencyKey: `supplier_return:${id}:in`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
    });
    return { id };
  });
}

export async function confirmSupplierReturnDispatch(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const r = await client.query<{
      status: string;
      warehouse_id: string;
      organization_id: string;
      item_id: string;
      batch_id: string | null;
      quantity_base: string;
    }>(
      `select status, warehouse_id, organization_id, item_id, batch_id, quantity_base
         from stock.supplier_returns where id = $1`,
      [returnId],
    );
    const row = r.rows[0];
    if (!row) throw new StockError('not_found', 'Supplier return not found');
    assertWarehouseAccess(actor, row.warehouse_id);
    if (row.status !== 'requested') {
      throw new StockError('conflict', `Cannot dispatch a ${row.status} return`);
    }
    const quarantine = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations
          where warehouse_id = $1 and scope = 'warehouse' and kind = 'quarantine'`,
        [row.warehouse_id],
      )
    ).rows[0]?.id;
    if (!quarantine) throw new StockError('not_found', 'Quarantine location missing');

    await postMovement(client, {
      organizationId: row.organization_id,
      stockLocationId: quarantine,
      itemId: row.item_id,
      batchId: row.batch_id,
      quantity: (-Number(row.quantity_base)).toFixed(6),
      movementType: 'issue',
      sourceDocType: 'supplier_return_dispatch',
      sourceDocId: returnId,
      idempotencyKey: `supplier_return:${returnId}:dispatch`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
    });
    await client.query(
      'update stock.supplier_returns set status = $2, confirmed_by = $3 where id = $1',
      [returnId, 'dispatched', actor.accountId ?? null],
    );
  });
}

export async function resolveSupplierReturn(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
  resolution: 'replacement' | 'credit_note' | 'refund' | 'supplier_rejected',
): Promise<void> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query<{ status: string }>(
      'select status from stock.supplier_returns where id = $1',
      [returnId],
    );
    const row = r.rows[0];
    if (!row) throw new StockError('not_found', 'Supplier return not found');
    if (row.status !== 'dispatched') {
      throw new StockError('conflict', `Cannot resolve a ${row.status} return`);
    }
    await client.query(
      `update stock.supplier_returns
          set status = 'resolved', resolution = $2, resolved_by = $3 where id = $1`,
      [returnId, resolution, actor.accountId ?? null],
    );
    await recordStockAudit(client, {
      action: 'supplier_return.resolved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      subjectType: 'supplier_return',
      subjectId: returnId,
      data: { resolution },
    });
  });
}

// ---- Reads -----------------------------------------------------

export async function listPurchaseOrders(
  pool: StockPool,
  actor: StockActor,
  opts: { warehouseId?: string; status?: string; limit?: number } = {},
): Promise<
  { id: string; poNumber: string; status: string; supplierId: string; totalPaise: number }[]
> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      po_number: string;
      status: string;
      supplier_id: string;
      total_paise: string;
    }>(
      `select id, po_number, status, supplier_id, total_paise
         from stock.purchase_orders
        where ($1::uuid is null or warehouse_id = $1)
          and ($2::text is null or status = $2::stock.po_status)
        order by created_at desc
        limit $3`,
      [opts.warehouseId ?? null, opts.status ?? null, Math.min(opts.limit ?? 50, 200)],
    );
    return rows.map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      status: r.status,
      supplierId: r.supplier_id,
      totalPaise: Number(r.total_paise),
    }));
  });
}
