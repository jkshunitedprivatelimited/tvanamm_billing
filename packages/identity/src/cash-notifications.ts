import { withActorContext, type Pool } from '@jksh/db';
import { systemContext } from './db-context';

/** Read only committed closes. Retrying never duplicates or reopens an alert. */
export async function notifyCashDifference(pool: Pool, sessionId: string): Promise<void> {
  try {
    await withActorContext(pool, systemContext(), async (client) => {
      await client.query(
        `insert into identity.notifications
          (organization_id, franchise_id, outlet_id, recipient_role, category, severity,
           title, body, entity_type, entity_id, dedup_key)
         select cs.organization_id, cs.franchise_id, cs.outlet_id, recipients.role,
           'financial_integrity', 'warning',
           case when cs.variance < 0 then 'Closing cash shortage' else 'Closing cash excess' end,
           o.display_name || ' · ' || cs.business_date::text || ' · Closed by ' || cs.closed_by_name ||
           '. Expected ₹' || cs.expected_cash::text || ', counted ₹' || cs.counted_cash::text ||
           '. Difference ₹' || abs(cs.variance)::text || '. Reason: ' || coalesce(cs.variance_reason, 'Not provided'),
           'cash_session', cs.id, 'cash-difference:' || cs.id::text || ':' || recipients.role
         from billing.cash_sessions cs
         join billing.outlets o on o.id = cs.outlet_id
         cross join (values ('central_admin'), ('franchise_owner')) recipients(role)
         where cs.id = $1 and cs.status = 'closed' and cs.variance <> 0
           and (recipients.role = 'central_admin' or cs.franchise_id is not null)
         on conflict (organization_id, dedup_key) do nothing`,
        [sessionId],
      );
    });
  } catch (error) {
    // A notification outage must not undo a completed register close.
    console.error('[notification] cash difference delivery failed', { sessionId, error });
  }
}
