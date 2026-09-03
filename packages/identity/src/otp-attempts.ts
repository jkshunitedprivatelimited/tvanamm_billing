import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import { systemContext } from './db-context';
import {
  DEFAULT_OTP_POLICY,
  EMPTY_OTP_STATE,
  otpSendGate,
  otpVerifyGate,
  registerOtpSend,
  registerOtpVerifyFailure,
  resetOtpState,
  type OtpAttemptState,
} from './otp';

async function load(client: PoolClient, mobile: string): Promise<OtpAttemptState> {
  const { rows } = await client.query<{
    sent_count: number;
    last_sent_at: Date | null;
    verify_failed_count: number;
    last_failed_at: Date | null;
    locked_until: Date | null;
    window_started_at: Date;
  }>(
    `select sent_count, last_sent_at, verify_failed_count, last_failed_at,
            locked_until, window_started_at
       from identity.otp_attempts where mobile = $1 for update`,
    [mobile],
  );
  const row = rows[0];
  if (!row) return { ...EMPTY_OTP_STATE, windowStartedAt: new Date() };
  return {
    sentCount: row.sent_count,
    lastSentAt: row.last_sent_at,
    verifyFailedCount: row.verify_failed_count,
    lastFailedAt: row.last_failed_at,
    lockedUntil: row.locked_until,
    windowStartedAt: row.window_started_at,
  };
}

async function save(client: PoolClient, mobile: string, state: OtpAttemptState): Promise<void> {
  await client.query(
    `insert into identity.otp_attempts
       (mobile, sent_count, last_sent_at, verify_failed_count, last_failed_at,
        locked_until, window_started_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (mobile) do update set
       sent_count = excluded.sent_count,
       last_sent_at = excluded.last_sent_at,
       verify_failed_count = excluded.verify_failed_count,
       last_failed_at = excluded.last_failed_at,
       locked_until = excluded.locked_until,
       window_started_at = excluded.window_started_at`,
    [
      mobile,
      state.sentCount,
      state.lastSentAt,
      state.verifyFailedCount,
      state.lastFailedAt,
      state.lockedUntil,
      state.windowStartedAt,
    ],
  );
}

export interface OtpGateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkAndRecordOtpSend(
  pool: Pool,
  mobile: string,
  now = new Date(),
): Promise<OtpGateResult> {
  return withActorContext(pool, systemContext(), async (client) => {
    const state = await load(client, mobile);
    const gate = otpSendGate(state, now);
    if (!gate.allowed) return { allowed: false, retryAfterSeconds: gate.retryAfterSeconds };
    await save(client, mobile, registerOtpSend(state, now));
    return { allowed: true, retryAfterSeconds: DEFAULT_OTP_POLICY.resendCooldownSeconds };
  });
}

export async function checkOtpVerify(
  pool: Pool,
  mobile: string,
  now = new Date(),
): Promise<OtpGateResult> {
  return withActorContext(pool, systemContext(), async (client) => {
    const gate = otpVerifyGate(await load(client, mobile), now);
    return { allowed: gate.allowed, retryAfterSeconds: gate.retryAfterSeconds };
  });
}

export async function recordOtpVerifyFailure(
  pool: Pool,
  mobile: string,
  now = new Date(),
): Promise<number> {
  return withActorContext(pool, systemContext(), async (client) => {
    const next = registerOtpVerifyFailure(await load(client, mobile), now);
    await save(client, mobile, next);
    return next.lockedUntil && next.lockedUntil > now
      ? Math.ceil((next.lockedUntil.getTime() - now.getTime()) / 1000)
      : 0;
  });
}

export async function resetOtpAttempts(
  pool: Pool,
  mobile: string,
  now = new Date(),
): Promise<void> {
  await withActorContext(pool, systemContext(), (client) =>
    save(client, mobile, resetOtpState(now)),
  );
}
