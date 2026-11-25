import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import {
  defaultReceiptSettings,
  receiptSettingsSchema,
  type ActorContext,
  type ReceiptSettings,
  type ReceiptSnapshot,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

/** Stored settings merged over defaults; unknown/invalid stored keys fall back. */
export async function readReceiptSettings(
  client: PoolClient,
  outletId: string,
): Promise<ReceiptSettings> {
  const { rows } = await client.query<{ settings: unknown }>(
    'select settings from billing.outlet_receipt_settings where outlet_id = $1',
    [outletId],
  );
  const parsed = receiptSettingsSchema.safeParse(rows[0]?.settings ?? {});
  return parsed.success ? parsed.data : defaultReceiptSettings();
}

async function outletScope(client: PoolClient, outletId: string) {
  const { rows } = await client.query<{ organization_id: string; franchise_id: string | null }>(
    'select organization_id, franchise_id from billing.outlets where id = $1',
    [outletId],
  );
  const row = rows[0];
  if (!row) throw new IdentityError('not_found', 'Outlet not found');
  return row;
}

function scopeOf(o: { organization_id: string; franchise_id: string | null }, outletId: string) {
  return {
    organizationId: o.organization_id,
    ...(o.franchise_id ? { franchiseId: o.franchise_id } : {}),
    outletId,
  };
}

export async function getReceiptSettings(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<ReceiptSettings> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    ensureAllowed(
      actor,
      'billing.outlet.manage',
      scopeOf(await outletScope(client, outletId), outletId),
    );
    return readReceiptSettings(client, outletId);
  });
}

export async function updateReceiptSettings(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
  input: unknown,
  meta: RequestMeta = {},
): Promise<ReceiptSettings> {
  const parsed = receiptSettingsSchema.safeParse(input);
  if (!parsed.success)
    throw new IdentityError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid receipt settings',
    );
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await outletScope(client, outletId);
    ensureAllowed(actor, 'billing.outlet.manage', scopeOf(outlet, outletId));
    await client.query(
      `insert into billing.outlet_receipt_settings
         (outlet_id, organization_id, franchise_id, settings, updated_by, updated_at)
       values ($1,$2,$3,$4,$5,now())
       on conflict (outlet_id) do update
         set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()`,
      [
        outletId,
        outlet.organization_id,
        outlet.franchise_id,
        JSON.stringify(parsed.data),
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'outlet.receipt_settings_updated',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { settings: parsed.data },
    });
    return parsed.data;
  });
}

/** "+919876543210" → "******3210"; keeps only the last four digits. */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `******${digits.slice(-4)}`;
}

/** Last 10 digits for Indian numbers ("+919876543210" → "9876543210"). */
function displayMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Add the optional, layout-driven fields to a receipt. */
export function applyReceiptSettings(
  receipt: ReceiptSnapshot,
  settings: ReceiptSettings,
  bill: { customerName: string | null; customerMobile: string | null; cashierName: string | null },
): ReceiptSnapshot {
  const mobile = bill.customerMobile?.trim() ?? '';
  const name = bill.customerName?.trim() ?? '';
  return {
    ...receipt,
    customerName: settings.showCustomerName && name ? name : null,
    customerMobile:
      !mobile || settings.customerMobile === 'hidden'
        ? null
        : settings.customerMobile === 'masked'
          ? maskMobile(mobile)
          : displayMobile(mobile),
    cashierName: settings.showCashierName ? bill.cashierName : null,
    headerNote: settings.headerNote || null,
    footerNote: settings.footerNote || null,
    layout: {
      showAddress: settings.showAddress,
      showOutletPhone: settings.showOutletPhone,
      showTime: settings.showTime,
      showPaymentMethod: settings.showPaymentMethod,
      showItemNotes: settings.showItemNotes,
    },
  };
}
