import { withActorContext, type Pool } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';

export interface AuditQuery {
  /** Match this action exactly, or — if it ends with "." — as a prefix. */
  action?: string;
  outletId?: string;
  from?: string; // YYYY-MM-DD (occurred_at date, inclusive)
  to?: string;
  limit?: number;
  /** Keyset cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

export interface AuditEventView {
  id: string;
  action: string;
  result: string | null;
  occurredAt: string;
  actorName: string | null;
  outletId: string | null;
  outletName: string | null;
  subjectId: string | null;
  correlationId: string;
  metadata: Record<string, unknown>;
}

export interface AuditPage {
  events: AuditEventView[];
  nextCursor: string | null;
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

/**
 * Reads the append-only audit trail. RLS already limits a Franchise Owner to
 * their own franchise's events; Central and Accountant see everything in the
 * organization. Keyset-paginated on (occurred_at desc, id desc).
 */
export async function listAuditEvents(
  pool: Pool,
  actor: ActorContext,
  q: AuditQuery = {},
): Promise<AuditPage> {
  ensureAllowed(actor, 'identity.audit.read', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });

  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${String(params.length)}`;
  };

  if (q.action) {
    if (q.action.endsWith('.')) where.push(`e.action like ${p(`${q.action}%`)}`);
    else where.push(`e.action = ${p(q.action)}`);
  }
  if (q.outletId) where.push(`e.outlet_id = ${p(q.outletId)}`);
  if (q.from) where.push(`e.occurred_at >= ${p(`${q.from}T00:00:00Z`)}`);
  if (q.to)
    where.push(`e.occurred_at < (${p(`${q.to}T00:00:00Z`)}::timestamptz + interval '1 day')`);

  const m = q.cursor ? CURSOR_RE.exec(q.cursor) : null;
  if (m) {
    where.push(`(e.occurred_at, e.id) < (${p(m[1])}::timestamptz, ${p(m[2])}::uuid)`);
  }

  const sql = `
    select e.id, e.action, e.result, e.occurred_at, e.subject_id, e.outlet_id, e.correlation_id,
           e.metadata,
           coalesce(ap.display_name, se.full_name) as actor_name,
           o.display_name as outlet_name
      from audit.events e
      left join identity.account_profiles ap on ap.id = e.actor_account_id
      left join identity.store_employees se on se.id = e.actor_employee_id
      left join billing.outlets o on o.id = e.outlet_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by e.occurred_at desc, e.id desc
     limit ${String(limit + 1)}`;

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      action: string;
      result: string | null;
      occurred_at: Date;
      subject_id: string | null;
      outlet_id: string | null;
      outlet_name: string | null;
      correlation_id: string;
      metadata: Record<string, unknown>;
      actor_name: string | null;
    }>(sql, params);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      events: page.map((r) => ({
        id: r.id,
        action: r.action,
        result: r.result,
        occurredAt: r.occurred_at.toISOString(),
        actorName: r.actor_name,
        outletId: r.outlet_id,
        outletName: r.outlet_name,
        subjectId: r.subject_id,
        correlationId: r.correlation_id,
        metadata: r.metadata,
      })),
      nextCursor: hasMore && last ? `${last.occurred_at.toISOString()}|${last.id}` : null,
    };
  });
}
