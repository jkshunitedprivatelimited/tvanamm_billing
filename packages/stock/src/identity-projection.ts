import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import type { StockActorRole } from '@jksh/contracts';
import { stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { recordStockAudit } from './audit';

/**
 * Facts about a request's Billing Identity session, already verified by
 * `@jksh/identity` in the shared Admin/POS portal. Stock turns these into a
 * local `StockActor`, consulting `stock.identity_projection` for the warehouse
 * role/assignments that Billing Identity does not model.
 */
export interface VerifiedIdentity {
  request: 'admin' | 'operator';
  billingRole: 'central_admin' | 'accountant' | 'franchise_owner' | 'store_employee';
  accountId?: string;
  employeeId?: string;
  organizationId: string;
  franchiseId?: string;
  outletId?: string;
}

const DIRECT_ROLE: Record<VerifiedIdentity['billingRole'], StockActorRole> = {
  central_admin: 'central_admin',
  accountant: 'accountant',
  franchise_owner: 'franchise_owner',
  store_employee: 'store_employee',
};

interface ProjectionRow {
  id: string;
  role: StockActorRole;
  organization_id: string;
  franchise_id: string | null;
  is_active: boolean;
}

async function loadProjection(
  client: StockPoolClient,
  id: VerifiedIdentity,
): Promise<ProjectionRow | null> {
  const key = id.accountId
    ? { column: 'account_id', value: id.accountId }
    : id.employeeId
      ? { column: 'employee_id', value: id.employeeId }
      : null;
  if (!key) return null;
  const { rows } = await client.query<ProjectionRow>(
    `select id, role, organization_id, franchise_id, is_active
       from stock.identity_projection where ${key.column} = $1`,
    [key.value],
  );
  return rows[0] ?? null;
}

/**
 * Resolve a verified Billing session to a Stock actor. A Central Admin may have
 * upgraded the account to a warehouse role via the projection; otherwise the
 * Billing role maps straight through.
 */
export async function resolveStockActor(
  pool: StockPool,
  id: VerifiedIdentity,
): Promise<StockActor> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const projection = await loadProjection(client, id);
    if (projection && !projection.is_active) {
      throw new StockError('forbidden', 'Stock access is disabled for this account');
    }
    const role: StockActorRole = projection?.role ?? DIRECT_ROLE[id.billingRole];

    let warehouseIds: string[] = [];
    if (projection && (role === 'warehouse_manager' || role === 'warehouse_staff')) {
      const wa = await client.query<{ warehouse_id: string }>(
        `select warehouse_id from stock.warehouse_assignments where projection_id = $1`,
        [projection.id],
      );
      warehouseIds = wa.rows.map((r) => r.warehouse_id);
    }

    return {
      request: id.request,
      role,
      ...(id.accountId ? { accountId: id.accountId } : {}),
      ...(id.employeeId ? { employeeId: id.employeeId } : {}),
      organizationId: id.organizationId,
      ...(id.franchiseId ? { franchiseId: id.franchiseId } : {}),
      ...(id.outletId ? { outletId: id.outletId } : {}),
      warehouseIds,
    };
  });
}

export interface UpsertProjectionCommand {
  accountId?: string | undefined;
  employeeId?: string | undefined;
  role: StockActorRole;
  organizationId: string;
  franchiseId?: string | undefined;
  displayName?: string | undefined;
  isActive?: boolean | undefined;
}

/** Central Admin grants or refreshes a Stock access projection for an account. */
export async function upsertIdentityProjection(
  pool: StockPool,
  actor: StockActor,
  cmd: UpsertProjectionCommand,
): Promise<{ id: string }> {
  if (actor.request !== 'system' && actor.role !== 'central_admin') {
    throw new StockError('forbidden', 'Only Central Admin manages Stock access');
  }
  if ((cmd.accountId ? 1 : 0) + (cmd.employeeId ? 1 : 0) !== 1) {
    throw new StockError('validation', 'Exactly one of accountId / employeeId is required');
  }
  if (cmd.role === 'franchise_owner' && !cmd.franchiseId) {
    throw new StockError('validation', 'franchise_owner projection requires franchiseId');
  }
  const subjectCol = cmd.accountId ? 'account_id' : 'employee_id';
  const subjectVal = cmd.accountId ?? cmd.employeeId;

  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into stock.identity_projection
         (${subjectCol}, role, organization_id, franchise_id, display_name, is_active)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (${subjectCol}) where ${subjectCol} is not null
       do update set role = excluded.role,
                     organization_id = excluded.organization_id,
                     franchise_id = excluded.franchise_id,
                     display_name = coalesce(excluded.display_name, stock.identity_projection.display_name),
                     is_active = excluded.is_active,
                     updated_at = now()
       returning id`,
      [
        subjectVal,
        cmd.role,
        cmd.organizationId,
        cmd.franchiseId ?? null,
        cmd.displayName ?? null,
        cmd.isActive ?? true,
      ],
    );
    const inserted = rows[0];
    if (!inserted) throw new StockError('conflict', 'Projection upsert returned no row');
    await recordStockAudit(client, {
      action: 'identity_projection.upserted',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      subjectType: 'identity_projection',
      subjectId: inserted.id,
      data: { role: cmd.role, subject: subjectCol },
    });
    return { id: inserted.id };
  });
}
