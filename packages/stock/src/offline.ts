import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordWastage } from './warehouse-ops';
import { recordLocalInward } from './local-inward';

export type OfflineDraftKind = 'local_inward' | 'wastage' | 'count_line' | 'receiving_line';

export interface EnqueueOfflineDraftCommand {
  deviceId: string;
  organizationId: string;
  outletId?: string | null | undefined;
  warehouseId?: string | null | undefined;
  kind: OfflineDraftKind;
  sequence: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

/**
 * Queue one physical command produced offline. Idempotent on
 * (device_id, idempotency_key) so a device that retries its durable browser
 * outbox never double-enqueues (`stock-v1-build-plan.md` "Offline and
 * Reliability").
 */
export async function enqueueOfflineDraft(
  pool: StockPool,
  actor: StockActor,
  cmd: EnqueueOfflineDraftCommand,
): Promise<{ id: string; duplicate: boolean }> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const existing = await client.query<{ id: string }>(
      'select id from stock.offline_drafts where device_id = $1 and idempotency_key = $2',
      [cmd.deviceId, cmd.idempotencyKey],
    );
    if (existing.rows[0]) return { id: existing.rows[0].id, duplicate: true };
    const ins = await client.query<{ id: string }>(
      `insert into stock.offline_drafts
         (device_id, organization_id, outlet_id, warehouse_id, kind, sequence, idempotency_key, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.deviceId,
        cmd.organizationId,
        cmd.outletId ?? null,
        cmd.warehouseId ?? null,
        cmd.kind,
        cmd.sequence,
        cmd.idempotencyKey,
        JSON.stringify(cmd.payload),
      ],
    );
    return { id: requireRow(ins, 'offline draft').id, duplicate: false };
  });
}

export interface SyncOfflineResult {
  applied: number;
  rejected: number;
  errors: { draftId: string; error: string }[];
}

/**
 * Apply a device's queued drafts in sequence order. Server acceptance is
 * authoritative: each draft is applied through the normal domain function (so
 * its own idempotency key still guards a genuine duplicate), and a failing
 * draft is marked rejected without blocking the rest.
 */
export async function syncOfflineDrafts(
  pool: StockPool,
  actor: StockActor,
  deviceId: string,
): Promise<SyncOfflineResult> {
  const drafts = await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      kind: OfflineDraftKind;
      payload: Record<string, unknown>;
    }>(
      `select id, kind, payload from stock.offline_drafts
        where device_id = $1 and status = 'queued' order by sequence asc`,
      [deviceId],
    );
    return rows;
  });

  const result: SyncOfflineResult = { applied: 0, rejected: 0, errors: [] };
  for (const draft of drafts) {
    try {
      const ref = await applyDraft(pool, actor, draft.kind, draft.payload);
      await withStockActorContext(pool, stockContextForActor(actor), (client) =>
        client.query(
          `update stock.offline_drafts set status = 'applied', applied_ref = $2, synced_at = now()
            where id = $1`,
          [draft.id, ref],
        ),
      );
      result.applied += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await withStockActorContext(pool, stockContextForActor(actor), (client) =>
        client.query(
          `update stock.offline_drafts set status = 'rejected', error = $2, synced_at = now()
            where id = $1`,
          [draft.id, message],
        ),
      );
      result.rejected += 1;
      result.errors.push({ draftId: draft.id, error: message });
    }
  }
  return result;
}

async function applyDraft(
  pool: StockPool,
  actor: StockActor,
  kind: OfflineDraftKind,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (kind === 'local_inward') {
    const r = await recordLocalInward(pool, actor, payload as never);
    return r.id;
  }
  if (kind === 'wastage') {
    const r = await recordWastage(pool, actor, payload as never);
    return r.id;
  }
  // count_line / receiving_line are queued but applied through their own
  // online flows once the count / receipt document exists.
  throw new StockError('validation', `Offline kind ${kind} is not auto-applied in V1`);
}

// ---- Feature flags -------------------------------------------------

export async function isStockFeatureEnabled(pool: StockPool, key: string): Promise<boolean> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{ enabled: boolean }>(
      'select enabled from stock.feature_flags where key = $1',
      [key],
    );
    return rows[0]?.enabled ?? false;
  });
}

export async function setStockFeatureFlag(
  pool: StockPool,
  actor: StockActor,
  key: string,
  enabled: boolean,
  config?: Record<string, unknown>,
): Promise<void> {
  if (actor.request !== 'system' && actor.role !== 'central_admin') {
    throw new StockError('forbidden', 'Only Central manages Stock feature flags');
  }
  await withStockActorContext(pool, stockContextForActor(actor), (client) =>
    client.query(
      `insert into stock.feature_flags (key, enabled, config)
       values ($1,$2,$3)
       on conflict (key) do update set enabled = excluded.enabled,
         config = coalesce(excluded.config, stock.feature_flags.config), updated_at = now()`,
      [key, enabled, config ? JSON.stringify(config) : JSON.stringify({})],
    ),
  );
}
