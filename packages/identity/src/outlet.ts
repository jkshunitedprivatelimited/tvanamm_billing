import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CreateOutletCommand,
  OutletLifecycleCommand,
  OutletSummary,
  UpdateOutletConfigCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context.js';
import { ensureAllowed } from './authz.js';
import { FRESH_AUTH_SECONDS } from './authorize.js';
import { recordAudit } from './audit.js';
import { IdentityError } from './errors.js';
import { generateActivationCode } from './ids.js';
import type { RequestMeta } from './admin-auth.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'outlet'}-${generateActivationCode().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)}`;
}

async function loadBrandOrg(
  client: PoolClient,
  brandId: string,
): Promise<{ organizationId: string }> {
  const { rows } = await client.query<{ organization_id: string }>(
    `select organization_id from billing.brands where id = $1`,
    [brandId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Brand not found');
  return { organizationId: rows[0].organization_id };
}

export async function createOutlet(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateOutletCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'billing.outlet.create', { organizationId: actor.scope.organizationId });

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { organizationId } = await loadBrandOrg(client, cmd.brandId);
    if (organizationId !== actor.scope.organizationId) {
      throw new IdentityError('forbidden', 'Brand is outside your organization');
    }
    if (cmd.ownershipType === 'franchise_owned') {
      const fr = await client.query(
        `select 1 from billing.franchises where id = $1 and organization_id = $2 and brand_id = $3`,
        [cmd.franchiseId, organizationId, cmd.brandId],
      );
      if (fr.rowCount === 0) throw new IdentityError('validation', 'Franchise does not match brand/org');
    }

    const id = randomUUID();
    await client.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status,
          display_name, legal_name, slug, phone, gstin, address_line, city, state,
          postal_code, country, timezone, payment_methods, created_by, managed_by)
       values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [
        id,
        organizationId,
        cmd.brandId,
        cmd.ownershipType === 'franchise_owned' ? cmd.franchiseId : null,
        cmd.ownershipType,
        cmd.displayName,
        cmd.legalName ?? null,
        slugify(cmd.displayName),
        cmd.phone ?? '',
        cmd.gstin ?? null,
        cmd.addressLine,
        cmd.city,
        cmd.state,
        cmd.postalCode,
        cmd.country,
        cmd.timezone,
        cmd.paymentMethods,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'outlet.created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId,
      franchiseId: cmd.ownershipType === 'franchise_owned' ? cmd.franchiseId : null,
      outletId: id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { ownershipType: cmd.ownershipType, displayName: cmd.displayName },
    });
    return { id };
  });
}

const LIFECYCLE: Record<
  OutletLifecycleCommand['action'],
  { from: string[]; to: string; audit: 'outlet.activated' | 'outlet.suspended' | 'outlet.closed' | 'outlet.reactivated' }
> = {
  activate: { from: ['draft'], to: 'active', audit: 'outlet.activated' },
  suspend: { from: ['active'], to: 'suspended', audit: 'outlet.suspended' },
  close: { from: ['active', 'suspended', 'draft'], to: 'closed', audit: 'outlet.closed' },
  reactivate: { from: ['suspended'], to: 'active', audit: 'outlet.reactivated' },
};

export async function outletLifecycle(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
  cmd: OutletLifecycleCommand,
  meta: RequestMeta = {},
): Promise<void> {
  ensureAllowed(
    actor,
    'billing.outlet.lifecycle',
    { organizationId: actor.scope.organizationId },
    { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
  );
  const rule = LIFECYCLE[cmd.action];

  await withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      status: string;
      organization_id: string;
      franchise_id: string | null;
    }>(
      `select status, organization_id, franchise_id from billing.outlets where id = $1 for update`,
      [outletId],
    );
    const row = rows[0];
    if (!row) throw new IdentityError('not_found', 'Outlet not found');
    if (!rule.from.includes(row.status)) {
      throw new IdentityError('conflict', `Cannot ${cmd.action} an outlet that is ${row.status}`);
    }

    const stamp =
      cmd.action === 'suspend'
        ? ', suspended_at = now()'
        : cmd.action === 'close'
          ? ', closed_at = now()'
          : cmd.action === 'reactivate'
            ? ', suspended_at = null'
            : '';
    await client.query(
      `update billing.outlets set status = $2::billing.outlet_status ${stamp} where id = $1`,
      [outletId, rule.to],
    );

    // Suspending or closing immediately revokes the outlet's terminal authorization.
    if (cmd.action === 'suspend' || cmd.action === 'close') {
      const revoked = await client.query<{ id: string }>(
        `update identity.terminals
           set status = 'revoked', revoked_at = now(), revoked_reason = 'outlet_' || $2,
               revoked_by = $3
         where outlet_id = $1 and status <> 'revoked'
         returning id`,
        [outletId, cmd.action, actor.accountId ?? null],
      );
      for (const t of revoked.rows) {
        await client.query(
          `update identity.terminal_credentials
             set status = 'revoked', revoked_at = now(), revoked_reason = 'outlet_' || $2
           where terminal_id = $1 and status = 'active'`,
          [t.id, cmd.action],
        );
      }
      await client.query(
        `update identity.operator_sessions
           set status = 'ended', ended_at = now(), revoked_reason = 'outlet_' || $2
         where outlet_id = $1 and status in ('active','locked')`,
        [outletId, cmd.action],
      );
    }

    await recordAudit(client, {
      action: rule.audit,
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      ...(cmd.reason ? { metadata: { reason: cmd.reason } } : {}),
    });
  });
}

export async function updateOutletConfig(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
  cmd: UpdateOutletConfigCommand,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      organization_id: string;
      franchise_id: string | null;
    }>(`select organization_id, franchise_id from billing.outlets where id = $1`, [outletId]);
    const row = rows[0];
    if (!row) throw new IdentityError('not_found', 'Outlet not found');

    ensureAllowed(actor, 'billing.outlet.manage', {
      organizationId: row.organization_id,
      ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
      outletId,
    });

    const sets: string[] = [];
    const values: unknown[] = [outletId];
    const put = (col: string, val: unknown): void => {
      values.push(val);
      sets.push(`${col} = $${String(values.length)}`);
    };
    if (cmd.displayName !== undefined) put('display_name', cmd.displayName);
    if (cmd.legalName !== undefined) put('legal_name', cmd.legalName);
    if (cmd.phone !== undefined) put('phone', cmd.phone);
    if (cmd.gstin !== undefined) put('gstin', cmd.gstin);
    if (cmd.addressLine !== undefined) put('address_line', cmd.addressLine);
    if (cmd.city !== undefined) put('city', cmd.city);
    if (cmd.state !== undefined) put('state', cmd.state);
    if (cmd.postalCode !== undefined) put('postal_code', cmd.postalCode);
    if (cmd.receiptConfig !== undefined) put('receipt_config', JSON.stringify(cmd.receiptConfig));
    if (sets.length === 0) return;

    await client.query(`update billing.outlets set ${sets.join(', ')} where id = $1`, values);
    await recordAudit(client, {
      action: 'outlet.config_changed',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { fields: Object.keys(cmd) },
    });
  });
}

export async function listOutlets(pool: Pool, actor: ActorContext): Promise<OutletSummary[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      display_name: string;
      ownership_type: OutletSummary['ownershipType'];
      status: OutletSummary['status'];
      brand_id: string;
      brand_name: string;
      franchise_id: string | null;
      franchise_name: string | null;
      city: string;
      gstin: string | null;
      billing_enabled: boolean;
      created_at: Date;
      has_active_terminal: boolean;
    }>(
      `select o.id, o.display_name, o.ownership_type, o.status, o.brand_id,
              b.name as brand_name, o.franchise_id, f.name as franchise_name,
              o.city, o.gstin, o.billing_enabled, o.created_at,
              exists (select 1 from identity.terminals t
                       where t.outlet_id = o.id and t.status <> 'revoked') as has_active_terminal
         from billing.outlets o
         join billing.brands b on b.id = o.brand_id
         left join billing.franchises f on f.id = o.franchise_id
        order by b.name, o.display_name`,
    );
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      ownershipType: r.ownership_type,
      status: r.status,
      brandId: r.brand_id,
      brandName: r.brand_name,
      ...(r.franchise_id ? { franchiseId: r.franchise_id } : {}),
      ...(r.franchise_name ? { franchiseName: r.franchise_name } : {}),
      city: r.city,
      ...(r.gstin ? { gstin: r.gstin } : {}),
      billingEnabled: r.billing_enabled,
      hasActiveTerminal: r.has_active_terminal,
      createdAt: r.created_at.toISOString(),
    }));
  });
}
