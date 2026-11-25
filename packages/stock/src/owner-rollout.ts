import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';

const schema = z.object({ organizationId: z.uuid(), outletIds: z.array(z.uuid()).max(500) });

/** Fail closed. Configuration does not replace franchise/organization membership. */
export async function listOwnerPilotOutlets(
  pool: StockPool,
  organizationId: string,
  franchiseId: string,
): Promise<string[]> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{ key: string; enabled: boolean; config: unknown }>(
      "select key,enabled,config from stock.feature_flags where key in ('stock.enabled','stock.owner_portal.enabled')",
    );
    const master = rows.find((r) => r.key === 'stock.enabled');
    const portal = rows.find((r) => r.key === 'stock.owner_portal.enabled');
    if (!master?.enabled || !portal?.enabled) return [];
    const parsed = schema.safeParse(portal.config);
    if (!parsed.success || parsed.data.organizationId !== organizationId) return [];
    const outlets = await client.query<{ outlet_id: string }>(
      `select outlet_id from stock.outlet_stock_settings
       where organization_id=$1 and franchise_id=$2 and outlet_id=any($3::uuid[]) and tracking_enabled`,
      [organizationId, franchiseId, parsed.data.outletIds],
    );
    return outlets.rows.map((r) => r.outlet_id);
  });
}
