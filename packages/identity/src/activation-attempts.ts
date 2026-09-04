import { createHash } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import { systemContext } from './db-context';
import {
  attemptGate,
  registerFailure,
  type AttemptGate,
  type AttemptState,
  type LockoutPolicy,
} from './pin';

/** Activation is a rare, deliberate operation, so the ladder is aggressive:
 *  a short grace, then a fast climb to a 15-minute hard lock. */
export const ACTIVATION_LOCKOUT_POLICY: LockoutPolicy = {
  softAt: 3,
  cooldownLadderSeconds: [30, 60, 120, 300],
  hardLockAt: 8,
  hardLockSeconds: 15 * 60,
};

/** Failed attempts older than this are forgiven (the row is treated as empty). */
const WINDOW_SECONDS = 30 * 60;

/** Caller identity for the throttle: the proxied client IP if we have one, else
 *  a single shared bucket. IPs are hashed so the table never stores an address. */
export function activationClientKey(ip: string | undefined): string {
  if (!ip) return 'global';
  return `ip:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
}

async function load(client: PoolClient, key: string, now: Date): Promise<AttemptState> {
  const { rows } = await client.query<{
    failed_count: number;
    last_failed_at: Date | null;
    locked_until: Date | null;
  }>(
    `insert into identity.activation_attempts (client_key) values ($1)
       on conflict (client_key) do update set client_key = excluded.client_key
     returning failed_count, last_failed_at, locked_until`,
    [key],
  );
  const r = rows[0] ?? { failed_count: 0, last_failed_at: null, locked_until: null };
  const stale =
    r.last_failed_at !== null &&
    now.getTime() - r.last_failed_at.getTime() > WINDOW_SECONDS * 1000 &&
    (r.locked_until === null || r.locked_until.getTime() <= now.getTime());
  if (stale) return { failedCount: 0, lastFailedAt: null, lockedUntil: null };
  return {
    failedCount: r.failed_count,
    lastFailedAt: r.last_failed_at,
    lockedUntil: r.locked_until,
  };
}

async function save(client: PoolClient, key: string, state: AttemptState): Promise<void> {
  await client.query(
    `update identity.activation_attempts
       set failed_count = $2, last_failed_at = $3, locked_until = $4,
           window_started_at = case when $2 = 0 then now() else window_started_at end
     where client_key = $1`,
    [key, state.failedCount, state.lastFailedAt, state.lockedUntil],
  );
}

/** Is this caller currently blocked from attempting an activation code? */
export async function checkActivationGate(
  pool: Pool,
  key: string,
  now = new Date(),
): Promise<AttemptGate> {
  return withActorContext(pool, systemContext(), async (client) => {
    const state = await load(client, key, now);
    return attemptGate(state, now, ACTIVATION_LOCKOUT_POLICY);
  });
}

/** Record one failed activation attempt; returns the retry-after seconds. */
export async function recordActivationFailure(
  pool: Pool,
  key: string,
  now = new Date(),
): Promise<number> {
  return withActorContext(pool, systemContext(), async (client) => {
    const next = registerFailure(await load(client, key, now), now, ACTIVATION_LOCKOUT_POLICY);
    await save(client, key, next);
    return attemptGate(next, now, ACTIVATION_LOCKOUT_POLICY).retryAfterSeconds;
  });
}

/** Clear the counter after a successful registration. */
export async function resetActivationAttempts(pool: Pool, key: string): Promise<void> {
  await withActorContext(pool, systemContext(), (client) =>
    save(client, key, { failedCount: 0, lastFailedAt: null, lockedUntil: null }),
  );
}
