import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, NotificationListResponse, NotificationView } from '@jksh/contracts';
import { MANDATORY_NOTIFICATION_CATEGORIES } from '@jksh/contracts';
import { contextForActor, systemContext } from './db-context';
import { IdentityError } from './errors';

export interface NotificationInput {
  organizationId: string;
  franchiseId?: string | null;
  outletId?: string | null;
  recipientRole?: 'central_admin' | 'accountant' | 'franchise_owner' | 'store_employee';
  recipientAccountId?: string;
  category: string;
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  /** Repeated events with the same key update one row instead of flooding. */
  dedupKey: string;
}

async function insertNotification(client: PoolClient, n: NotificationInput): Promise<void> {
  await client.query(
    `insert into identity.notifications
       (organization_id, franchise_id, outlet_id, recipient_role, recipient_account_id,
        category, severity, title, body, entity_type, entity_id, dedup_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (organization_id, dedup_key) do update set
       event_count = identity.notifications.event_count + 1,
       created_at = now(),
       read_at = null,
       resolved_at = null,
       severity = excluded.severity,
       title = excluded.title,
       body = excluded.body`,
    [
      n.organizationId,
      n.franchiseId ?? null,
      n.outletId ?? null,
      n.recipientRole ?? null,
      n.recipientAccountId ?? null,
      n.category,
      n.severity ?? 'info',
      n.title,
      n.body ?? null,
      n.entityType ?? null,
      n.entityId ?? null,
      n.dedupKey,
    ],
  );
}

/** Fire-and-forget emission in its own system-context transaction: a
 *  notification failure must never roll back the bill / movement / payment
 *  that triggered it (`operational-notifications.md`). */
export async function emitNotification(pool: Pool, n: NotificationInput): Promise<void> {
  try {
    await withActorContext(pool, systemContext(), (client) => insertNotification(client, n));
  } catch (err) {
    console.error('[notification] emit failed', {
      category: n.category,
      dedupKey: n.dedupKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Same, but joins an existing transaction - use only where the caller has
 *  already accepted that a failure rolls the whole thing back (rare). */
export async function emitNotificationInTx(
  client: PoolClient,
  n: NotificationInput,
): Promise<void> {
  await insertNotification(client, n);
}

function toView(r: {
  id: string;
  category: string;
  severity: NotificationView['severity'];
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  outlet_id: string | null;
  event_count: number;
  created_at: Date;
  read_at: Date | null;
  resolved_at: Date | null;
}): NotificationView {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity,
    title: r.title,
    body: r.body,
    entityType: r.entity_type,
    entityId: r.entity_id,
    outletId: r.outlet_id,
    eventCount: r.event_count,
    createdAt: r.created_at.toISOString(),
    readAt: r.read_at?.toISOString() ?? null,
    resolvedAt: r.resolved_at?.toISOString() ?? null,
  };
}

export async function listNotifications(
  pool: Pool,
  actor: ActorContext,
  opts: { unreadOnly?: boolean; cursor?: string; limit?: number } = {},
): Promise<NotificationListResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const params: unknown[] = [];
    let where = '1=1';
    if (opts.unreadOnly) where += ` and read_at is null`;
    if (opts.cursor) {
      params.push(opts.cursor);
      where += ` and created_at < $${String(params.length)}`;
    }
    params.push(limit + 1);
    const rows = await client.query<Parameters<typeof toView>[0]>(
      `select id, category, severity, title, body, entity_type, entity_id, outlet_id,
              event_count, created_at, read_at, resolved_at
         from identity.notifications where ${where}
        order by created_at desc limit $${String(params.length)}`,
      params,
    );
    const unread = await client.query<{ n: string }>(
      `select count(*) as n from identity.notifications where read_at is null`,
    );
    const page = rows.rows.slice(0, limit);
    const nextCursor =
      rows.rows.length > limit ? (page[page.length - 1]?.created_at.toISOString() ?? null) : null;
    return {
      notifications: page.map(toView),
      nextCursor,
      unreadCount: Number(unread.rows[0]?.n ?? 0),
    };
  });
}

export async function markNotification(
  pool: Pool,
  actor: ActorContext,
  id: string,
  what: 'read' | 'resolved',
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const col = what === 'read' ? 'read_at' : 'resolved_at';
    const extra = what === 'resolved' ? ', read_at = coalesce(read_at, now())' : '';
    const res = await client.query(
      `update identity.notifications set ${col} = coalesce(${col}, now())${extra} where id = $1`,
      [id],
    );
    if (res.rowCount === 0) throw new IdentityError('not_found', 'Notification not found');
  });
}

export async function markAllNotificationsRead(pool: Pool, actor: ActorContext): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await client.query(`update identity.notifications set read_at = now() where read_at is null`);
  });
}

export async function setNotificationMute(
  pool: Pool,
  actor: ActorContext,
  category: string,
  muted: boolean,
): Promise<void> {
  if (!actor.accountId) throw new IdentityError('forbidden', 'An account is required');
  if (muted && (MANDATORY_NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
    throw new IdentityError('validation', 'This category cannot be muted');
  }
  return withActorContext(pool, contextForActor(actor), async (client) => {
    if (muted) {
      await client.query(
        `insert into identity.notification_mutes (account_id, category) values ($1,$2)
         on conflict do nothing`,
        [actor.accountId, category],
      );
    } else {
      await client.query(
        `delete from identity.notification_mutes where account_id = $1 and category = $2`,
        [actor.accountId, category],
      );
    }
  });
}
