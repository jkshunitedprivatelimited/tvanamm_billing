import 'server-only';
import type { ActorContext } from '@jksh/contracts';
import { db } from './pool';

export interface OutletRow {
  id: string;
  name: string;
  address: string;
  franchiseId: string;
  franchiseName: string;
}

/** Outlets the actor may see, scoped by their membership. */
export async function listOutletsForActor(actor: ActorContext): Promise<OutletRow[]> {
  const scope = actor.membership.scope;
  const params: string[] = [scope.organizationId];
  let where = 'o.organization_id = $1';
  if (scope.franchiseId) {
    params.push(scope.franchiseId);
    where += ` and o.franchise_id = $${String(params.length)}`;
  }
  const { rows } = await db().query<{
    id: string;
    name: string;
    address: string;
    franchise_id: string;
    franchise_name: string;
  }>(
    `select o.id, o.name, o.address, o.franchise_id, f.name as franchise_name
       from identity.outlets o
       join identity.franchises f on f.id = o.franchise_id
      where ${where} and o.status = 'active'
      order by f.name, o.name`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    franchiseId: r.franchise_id,
    franchiseName: r.franchise_name,
  }));
}

export interface OutletHeader {
  id: string;
  name: string;
  address: string;
  organizationId: string;
  franchiseId: string;
}

export async function getOutlet(outletId: string): Promise<OutletHeader | null> {
  const { rows } = await db().query<{
    id: string;
    name: string;
    address: string;
    organization_id: string;
    franchise_id: string;
  }>(
    `select id, name, address, organization_id, franchise_id
       from identity.outlets where id = $1`,
    [outletId],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        name: r.name,
        address: r.address,
        organizationId: r.organization_id,
        franchiseId: r.franchise_id,
      }
    : null;
}
