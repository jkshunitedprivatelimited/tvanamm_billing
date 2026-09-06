import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, PrintAttemptCommand, ReceiptSnapshot } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

async function loadBillForOutlet(
  client: PoolClient,
  billId: string,
): Promise<{
  outlet_id: string;
  organization_id: string;
  franchise_id: string | null;
  terminal_id: string;
  business_date: string;
}> {
  const { rows } = await client.query<{
    outlet_id: string;
    organization_id: string;
    franchise_id: string | null;
    terminal_id: string;
    business_date: string;
  }>(
    `select outlet_id, organization_id, franchise_id, terminal_id, business_date::text as business_date
       from billing.bills where id = $1`,
    [billId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Bill not found');
  return rows[0];
}

/** Any Store Employee at the outlet may (re)print any current-day bill - not
 *  only the one they created (`billing-history-refunds.md`). Every attempt,
 *  success or failure, is permanently logged. */
export async function recordPrintAttempt(
  pool: Pool,
  actor: ActorContext,
  billId: string,
  cmd: PrintAttemptCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  if (actor.kind !== 'operator' || !actor.employeeId || !actor.outletId) {
    throw new IdentityError('forbidden', 'A store operator session is required');
  }
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const bill = await loadBillForOutlet(client, billId);
    if (bill.outlet_id !== actor.outletId) {
      throw new IdentityError('forbidden', 'Bill belongs to a different outlet');
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.print_attempts
         (id, bill_id, outlet_id, terminal_id, actor_employee_id, result, reason, is_reprint)
       values ($1,$2,$3,$4,$5,$6,$7,true)`,
      [
        id,
        billId,
        bill.outlet_id,
        actor.terminalId ?? null,
        actor.employeeId,
        cmd.result,
        cmd.reason ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'bill.print_attempted',
      result: cmd.result === 'success' ? 'success' : 'failure',
      actorEmployeeId: actor.employeeId,
      subjectId: billId,
      organizationId: bill.organization_id,
      franchiseId: bill.franchise_id,
      outletId: bill.outlet_id,
      terminalId: actor.terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { printAttemptId: id, result: cmd.result },
    });
    return { id };
  });
}

/** Customer-facing structured receipt data: no employee name, no discount or
 *  refund reasons, no internal ids, no GST rate/CGST/SGST breakout. */
export async function getReceiptSnapshot(
  pool: Pool,
  actor: ActorContext,
  billId: string,
): Promise<ReceiptSnapshot> {
  ensureAllowed(actor, 'billing.sale.read.own_store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    ...(actor.outletId ? { outletId: actor.outletId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const b = await client.query<{
      outlet_id: string;
      receipt_number: string;
      business_date: string;
      committed_at: Date;
      subtotal: string;
      discount_total: string;
      round_adjustment: string;
      final_total: string;
      payment_method: ReceiptSnapshot['paymentMethod'];
      is_complimentary: boolean;
    }>(
      `select outlet_id, receipt_number, business_date::text as business_date, committed_at,
              subtotal, discount_total, round_adjustment, final_total, payment_method,
              is_complimentary
         from billing.bills where id = $1`,
      [billId],
    );
    const bill = b.rows[0];
    if (!bill) throw new IdentityError('not_found', 'Bill not found');

    const outlet = await client.query<{
      display_name: string;
      address_line: string;
      city: string;
      state: string;
      postal_code: string;
      phone: string;
      gstin: string | null;
    }>(
      `select display_name, address_line, city, state, postal_code, phone, gstin
         from billing.outlets where id = $1`,
      [bill.outlet_id],
    );
    const o = outlet.rows[0];
    if (!o) throw new IdentityError('not_found', 'Outlet not found');

    const lines = await client.query<{
      id: string;
      item_name: string;
      quantity: number;
      unit_price: string;
      discount: string;
      final_total: string;
      note: string | null;
      combo_name: string | null;
      offer_label: string | null;
    }>(
      `select id, item_name, quantity, unit_price, discount, final_total, note, combo_name,
              offer_label
         from billing.bill_lines where bill_id = $1 order by line_no`,
      [billId],
    );
    const addons = await client.query<{
      bill_line_id: string;
      addon_name: string;
      quantity: number;
      unit_price: string;
    }>(
      `select bill_line_id, addon_name, quantity, unit_price
         from billing.bill_line_addons where bill_line_id = any($1::uuid[])`,
      [lines.rows.map((l) => l.id)],
    );

    return {
      outletName: o.display_name,
      outletAddress: [o.address_line, o.city, o.state, o.postal_code].filter(Boolean).join(', '),
      outletPhone: o.phone || null,
      gstin: o.gstin,
      receiptNumber: bill.receipt_number,
      businessDate: bill.business_date,
      committedAt: bill.committed_at.toISOString(),
      lines: lines.rows.map((l) => ({
        itemName: l.item_name,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        discount: l.discount,
        finalTotal: l.final_total,
        note: l.note,
        comboName: l.combo_name,
        offerLabel: l.offer_label,
        addons: addons.rows
          .filter((a) => a.bill_line_id === l.id)
          .map((a) => ({ addonName: a.addon_name, quantity: a.quantity, unitPrice: a.unit_price })),
      })),
      subtotal: bill.subtotal,
      discountTotal: bill.discount_total,
      roundAdjustment: bill.round_adjustment,
      finalTotal: bill.final_total,
      paymentMethod: bill.payment_method,
      isComplimentary: bill.is_complimentary,
    };
  });
}
