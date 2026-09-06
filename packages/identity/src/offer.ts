import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CreateOfferCommand,
  OfferLifecycleCommand,
  OfferView,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

function assertOfferWrite(actor: ActorContext, originOutletId: string | undefined): void {
  if (originOutletId) {
    ensureAllowed(actor, 'billing.offer.manage.franchise', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId: originOutletId,
    });
  } else {
    ensureAllowed(actor, 'billing.offer.manage.master', {
      organizationId: actor.scope.organizationId,
    });
  }
}

export async function createOffer(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateOfferCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  assertOfferWrite(actor, cmd.originOutletId);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const brand = await client.query<{ organization_id: string }>(
      `select organization_id from billing.brands where id = $1`,
      [cmd.brandId],
    );
    if (brand.rows[0]?.organization_id !== actor.scope.organizationId) {
      throw new IdentityError('validation', 'Brand is outside your organization');
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.offers
         (id, organization_id, brand_id, owner_scope, origin_outlet_id, name, label,
          discount_kind, discount_value, priority, starts_on, ends_on, days_of_week,
          start_time, end_time, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.originOutletId ? 'outlet' : 'master',
        cmd.originOutletId ?? null,
        cmd.name,
        cmd.label,
        cmd.discountKind,
        cmd.discountValue,
        cmd.priority,
        cmd.startsOn,
        cmd.endsOn,
        cmd.daysOfWeek ?? null,
        cmd.startTime ?? null,
        cmd.endTime ?? null,
        actor.accountId ?? null,
      ],
    );
    for (const t of cmd.targets) {
      await client.query(
        `insert into billing.offer_targets (offer_id, target_type, target_id) values ($1,$2,$3)
         on conflict do nothing`,
        [id, t.targetType, t.targetId],
      );
    }
    for (const outletId of cmd.outletIds) {
      await client.query(
        `insert into billing.offer_outlets (offer_id, outlet_id) values ($1,$2)
         on conflict do nothing`,
        [id, outletId],
      );
    }
    await recordAudit(client, {
      action: 'offer.created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(cmd.originOutletId ? { outletId: cmd.originOutletId } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { offerId: id, name: cmd.name, label: cmd.label },
    });
    return { id };
  });
}

/** Publication is a state change plus a version bump - "Publication creates
 *  a new version and never changes an open cart" (`scheduled-offers.md`). */
export async function offerLifecycle(
  pool: Pool,
  actor: ActorContext,
  offerId: string,
  cmd: OfferLifecycleCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const seen = await client.query<{ origin_outlet_id: string | null; state: string }>(
      `select origin_outlet_id, state from billing.offers where id = $1`,
      [offerId],
    );
    if (!seen.rows[0]) throw new IdentityError('not_found', 'Offer not found');
    assertOfferWrite(actor, seen.rows[0].origin_outlet_id ?? undefined);

    const nextState =
      cmd.action === 'publish' ? 'active' : cmd.action === 'pause' ? 'paused' : 'active';
    await client.query(
      `update billing.offers
          set state = $2, version = case when $3 = 'publish' then version + 1 else version end
        where id = $1`,
      [offerId, nextState, cmd.action],
    );
    await recordAudit(client, {
      action: cmd.action === 'pause' ? 'offer.paused' : 'offer.published',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(seen.rows[0].origin_outlet_id ? { outletId: seen.rows[0].origin_outlet_id } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { offerId, action: cmd.action },
    });
  });
}

export async function listOffers(
  pool: Pool,
  actor: ActorContext,
  opts: { brandId?: string; outletId?: string },
): Promise<OfferView[]> {
  ensureAllowed(
    actor,
    actor.scope.franchiseId ? 'billing.offer.manage.franchise' : 'billing.offer.manage.master',
    {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    },
  );
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const params: unknown[] = [];
    let where = '1=1';
    if (opts.brandId) {
      params.push(opts.brandId);
      where += ` and o.brand_id = $${String(params.length)}`;
    }
    if (opts.outletId) {
      params.push(opts.outletId);
      where += ` and o.id in (select offer_id from billing.offer_outlets where outlet_id = $${String(params.length)})`;
    }
    const offers = await client.query<{
      id: string;
      name: string;
      label: string;
      discount_kind: OfferView['discountKind'];
      discount_value: string;
      priority: number;
      state: OfferView['state'];
      starts_on: string;
      ends_on: string;
      days_of_week: number[] | null;
      start_time: string | null;
      end_time: string | null;
      version: number;
    }>(
      `select id, name, label, discount_kind, discount_value, priority, state,
              starts_on::text, ends_on::text, days_of_week, start_time::text, end_time::text, version
         from billing.offers o where ${where} order by o.priority, o.created_at desc`,
      params,
    );
    const ids = offers.rows.map((o) => o.id);
    const targets = ids.length
      ? await client.query<{ offer_id: string; target_type: 'item' | 'combo'; target_id: string }>(
          `select offer_id, target_type, target_id from billing.offer_targets where offer_id = any($1::uuid[])`,
          [ids],
        )
      : { rows: [] };
    const outlets = ids.length
      ? await client.query<{ offer_id: string; outlet_id: string }>(
          `select offer_id, outlet_id from billing.offer_outlets where offer_id = any($1::uuid[])`,
          [ids],
        )
      : { rows: [] };
    return offers.rows.map((o) => ({
      id: o.id,
      name: o.name,
      label: o.label,
      discountKind: o.discount_kind,
      discountValue: o.discount_value,
      priority: o.priority,
      state: o.state,
      startsOn: o.starts_on,
      endsOn: o.ends_on,
      daysOfWeek: o.days_of_week,
      startTime: o.start_time,
      endTime: o.end_time,
      version: o.version,
      targets: targets.rows
        .filter((t) => t.offer_id === o.id)
        .map((t) => ({ targetType: t.target_type, targetId: t.target_id })),
      outletIds: outlets.rows.filter((x) => x.offer_id === o.id).map((x) => x.outlet_id),
    }));
  });
}

export interface ResolvedOffer {
  offerId: string;
  label: string;
  discountKind: 'fixed' | 'percent';
  discountValue: string;
}

/** The single best active offer for one item/combo at one outlet at one
 *  instant: date + optional day-of-week + optional time window must all
 *  cover `now` (in the outlet's timezone); lowest `priority` wins, then
 *  earliest id. Scheduled offers never stack with each other. */
export async function resolveOffersForOutlet(
  client: PoolClient,
  outletId: string,
  timezone: string,
  now: Date,
): Promise<Map<string, ResolvedOffer>> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (t: string): string => fmt.find((p) => p.type === t)?.value ?? '';
  const localDate = `${part('year')}-${part('month')}-${part('day')}`;
  const localMinutes = Number(part('hour')) * 60 + Number(part('minute'));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));

  const { rows } = await client.query<{
    id: string;
    label: string;
    discount_kind: 'fixed' | 'percent';
    discount_value: string;
    priority: number;
    days_of_week: number[] | null;
    start_time: string | null;
    end_time: string | null;
    target_type: 'item' | 'combo';
    target_id: string;
  }>(
    `select o.id, o.label, o.discount_kind, o.discount_value, o.priority,
            o.days_of_week, o.start_time::text, o.end_time::text,
            t.target_type, t.target_id
       from billing.offers o
       join billing.offer_outlets oo on oo.offer_id = o.id and oo.outlet_id = $1
       join billing.offer_targets t on t.offer_id = o.id
      where o.state = 'active' and $2::date between o.starts_on and o.ends_on
      order by o.priority, o.id`,
    [outletId, localDate],
  );

  const inTimeWindow = (start: string | null, end: string | null): boolean => {
    if (!start || !end) return true;
    const toMin = (s: string): number => {
      const [h, m] = s.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    const s = toMin(start);
    const e = toMin(end);
    return s <= e ? localMinutes >= s && localMinutes <= e : localMinutes >= s || localMinutes <= e;
  };

  // rows are already priority-ordered; the first match per target wins.
  const best = new Map<string, ResolvedOffer>();
  for (const r of rows) {
    if (r.days_of_week && !r.days_of_week.includes(dow)) continue;
    if (!inTimeWindow(r.start_time, r.end_time)) continue;
    const key = `${r.target_type}:${r.target_id}`;
    if (!best.has(key)) {
      best.set(key, {
        offerId: r.id,
        label: r.label,
        discountKind: r.discount_kind,
        discountValue: r.discount_value,
      });
    }
  }
  return best;
}
