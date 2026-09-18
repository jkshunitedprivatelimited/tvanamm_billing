import { withActorContext, type Pool } from '@jksh/db';
import { lowStockEventSchema, type LowStockEvent } from '@jksh/contracts';
import { systemContext } from './db-context';
import { IdentityError } from './errors';

/** Durable receiver: never swallow delivery errors. Opening an episode uses
 * DO NOTHING on retry so reading/resolving a notice cannot be undone by replay. */
export async function receiveLowStockNotification(pool: Pool, raw: LowStockEvent): Promise<void> {
  const event = lowStockEventSchema.parse(raw);
  await withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{ display_name: string; franchise_id: string | null }>(
      'select display_name, franchise_id from billing.outlets where id = $1 and organization_id = $2',
      [event.outletId, event.organizationId],
    );
    const outlet = rows[0];
    if (!outlet) throw new IdentityError('validation', 'Stock alert outlet does not exist');
    if (outlet.franchise_id !== event.franchiseId) {
      throw new IdentityError('validation', 'Stock alert outlet scope does not match Billing');
    }
    const recipients = ['central_admin', ...(event.franchiseId ? ['franchise_owner'] : [])];
    for (const role of recipients) {
      const key = `stock-low:${event.episodeId}:${role}`;
      if (event.state === 'resolved') {
        await client.query(
          `update identity.notifications set resolved_at = coalesce(resolved_at, now()),
          read_at = coalesce(read_at, now()) where organization_id = $1 and dedup_key = $2`,
          [event.organizationId, key],
        );
      } else {
        const quantity = Number(event.quantity).toLocaleString('en-IN', {
          maximumFractionDigits: 6,
        });
        const threshold = Number(event.threshold).toLocaleString('en-IN', {
          maximumFractionDigits: 6,
        });
        await client.query(
          `insert into identity.notifications
          (organization_id, franchise_id, outlet_id, recipient_role, category, severity, title, body, entity_type, entity_id, dedup_key)
          values ($1,$2,$3,$4,'stock.low','warning',$5,$6,'stock_low',$7,$8)
          on conflict (organization_id, dedup_key) do nothing`,
          [
            event.organizationId,
            event.franchiseId,
            event.outletId,
            role,
            `Low stock: ${event.itemName}`.slice(0, 200),
            `${outlet.display_name}: ${quantity} ${event.baseUnit} available at detection. Alert limit: ${threshold} ${event.baseUnit}. Open stock alerts for the current balance.`,
            event.itemId,
            key,
          ],
        );
      }
    }
  });
}
