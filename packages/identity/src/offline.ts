import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  OfflineAuthResponse,
  ReceiptBlockResponse,
  ReserveReceiptBlockCommand,
  SyncBillResult,
  SyncBillsCommand,
  SyncBillsResponse,
} from '@jksh/contracts';
import { contextForActor, systemContext } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import { mintOfflineAuthBundle } from './offline-auth';
import { createBill, formatReceiptNumber } from './bills';
import type { RequestMeta } from './admin-auth';

const SYNC_RATE_WINDOW_SECONDS = 60;
const SYNC_RATE_MAX_PER_WINDOW = 20;
const MAX_SYNC_BATCH = 100;

function requireOperator(actor: ActorContext): {
  outletId: string;
  terminalId: string;
  employeeId: string;
} {
  if (actor.kind !== 'operator' || !actor.outletId || !actor.terminalId || !actor.employeeId) {
    throw new IdentityError('forbidden', 'A store operator session is required');
  }
  return { outletId: actor.outletId, terminalId: actor.terminalId, employeeId: actor.employeeId };
}

/** A coarse per-terminal request budget for the offline-authorization and
 *  sync-batch endpoints, on top of the per-bill idempotency key. */
async function checkSyncRateLimit(pool: Pool, terminalId: string): Promise<void> {
  await withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{ window_started_at: Date; request_count: number }>(
      `insert into identity.sync_attempts (terminal_id) values ($1)
         on conflict (terminal_id) do update set terminal_id = excluded.terminal_id
       returning window_started_at, request_count`,
      [terminalId],
    );
    const now = Date.now();
    const row = rows[0];
    const windowExpired =
      !row || now - row.window_started_at.getTime() > SYNC_RATE_WINDOW_SECONDS * 1000;
    const nextCount = windowExpired ? 1 : row.request_count + 1;
    if (!windowExpired && row.request_count >= SYNC_RATE_MAX_PER_WINDOW) {
      throw new IdentityError('sync_rate_limited', 'Too many sync requests. Slow down.', {
        details: { retryAfterSeconds: SYNC_RATE_WINDOW_SECONDS },
      });
    }
    await client.query(
      `update identity.sync_attempts
          set request_count = $2, window_started_at = case when $3 then now() else window_started_at end
        where terminal_id = $1`,
      [terminalId, nextCount, windowExpired],
    );
  });
}

async function currentMenuVersion(
  client: PoolClient,
  outletId: string,
): Promise<{ version: string; checksum: string }> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    `select version::text, checksum from billing.outlet_menu_versions
      where outlet_id = $1 and is_current`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('conflict', 'This outlet has no published menu');
  return rows[0];
}

/** Issued while online: the set of employees, menu snapshot, and discount
 *  ceiling a terminal may keep selling against for the next 24 hours. */
export async function issueOfflineAuth(
  pool: Pool,
  actor: ActorContext,
  meta: RequestMeta = {},
): Promise<OfflineAuthResponse> {
  const { outletId, terminalId } = requireOperator(actor);
  ensureAllowed(actor, 'billing.sale.create', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });
  await checkSyncRateLimit(pool, terminalId);

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const menu = await currentMenuVersion(client, outletId);
    const employees = await client.query<{ id: string }>(
      `select id from identity.store_employees where outlet_id = $1 and status = 'active'`,
      [outletId],
    );
    const { token, bundle } = mintOfflineAuthBundle(identityTokenSecret(), {
      organizationId: actor.scope.organizationId,
      outletId,
      terminalId,
      employeeIds: employees.rows.map((r) => r.id),
      menuVersion: menu.version,
      menuChecksum: menu.checksum,
    });
    await recordAudit(client, {
      action: 'offline_auth.issued',
      result: 'success',
      actorEmployeeId: actor.employeeId,
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { menuVersion: menu.version, employeeCount: employees.rows.length },
    });
    return { token, issuedAt: bundle.issuedAt, expiresAt: bundle.expiresAt };
  });
}

/** Marks any part of a PAST reservation still unused as void once it has
 *  expired, so a gap in the printed sequence is a recorded, explained void
 *  rather than a silently reassignable number. Never touches the active
 *  reservation being issued right now. */
async function voidExpiredReservations(
  client: PoolClient,
  outletId: string,
  prefix: string,
): Promise<void> {
  const expired = await client.query<{
    id: string;
    business_date: string;
    start_seq: number;
    end_seq: number;
  }>(
    // business_date is cast to text - see the note in bills.ts loadBill.
    `select id, business_date::text as business_date, start_seq, end_seq
       from billing.receipt_reservations
      where outlet_id = $1 and prefix = $2 and status = 'active' and expires_at < now()
      for update`,
    [outletId, prefix],
  );
  for (const r of expired.rows) {
    const businessDateStr = r.business_date;
    const used = await client.query<{ receipt_number: string }>(
      `select receipt_number from billing.bills
        where outlet_id = $1 and business_date = $2 and receipt_number like $3`,
      [outletId, businessDateStr, `${businessDateStr.replace(/-/g, '')}-${prefix}-%`],
    );
    const usedSeqs = new Set(used.rows.map((u) => Number(u.receipt_number.slice(-6))));
    let voidedAny = false;
    for (let seq = r.start_seq; seq <= r.end_seq; seq += 1) {
      if (usedSeqs.has(seq)) continue;
      voidedAny = true;
      await client.query(
        `insert into billing.receipt_number_voids (outlet_id, reservation_id, receipt_number)
         values ($1,$2,$3) on conflict (outlet_id, receipt_number) do nothing`,
        [outletId, r.id, formatReceiptNumber(businessDateStr, prefix, seq)],
      );
    }
    await client.query(`update billing.receipt_reservations set status = $2 where id = $1`, [
      r.id,
      voidedAny ? 'voided' : 'consumed',
    ]);
  }
}

/** Reserves a contiguous block of receipt numbers for offline use, expiring
 *  with the same 24h window as the offline-authorization bundle. */
export async function reserveReceiptBlock(
  pool: Pool,
  actor: ActorContext,
  cmd: ReserveReceiptBlockCommand,
  meta: RequestMeta = {},
): Promise<ReceiptBlockResponse> {
  const { outletId, terminalId } = requireOperator(actor);
  ensureAllowed(actor, 'billing.sale.create', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });
  await checkSyncRateLimit(pool, terminalId);

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows: outletRows } = await client.query<{ timezone: string }>(
      `select timezone from billing.outlets where id = $1`,
      [outletId],
    );
    if (!outletRows[0]) throw new IdentityError('not_found', 'Outlet not found');
    const businessDateStr = businessDateString(new Date(), outletRows[0].timezone);

    const { rows: termRows } = await client.query<{ receipt_prefix: string }>(
      `select receipt_prefix from identity.terminals where id = $1`,
      [terminalId],
    );
    const prefix = termRows[0]?.receipt_prefix ?? 'T01';

    await voidExpiredReservations(client, outletId, prefix);

    const seq = await client.query<{ last_seq: number }>(
      `insert into billing.receipt_sequences (outlet_id, prefix, business_date, last_seq, last_terminal_id)
       values ($1,$2,$3,$4,$5)
       on conflict (outlet_id, prefix, business_date)
         do update set last_seq = billing.receipt_sequences.last_seq + $4, last_terminal_id = $5
       returning last_seq`,
      [outletId, prefix, businessDateStr, cmd.count, terminalId],
    );
    const endSeq = seq.rows[0]?.last_seq ?? cmd.count;
    const startSeq = endSeq - cmd.count + 1;

    const reservation = await client.query<{ expires_at: Date }>(
      `insert into billing.receipt_reservations
         (outlet_id, terminal_id, prefix, business_date, start_seq, end_seq, expires_at)
       values ($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       returning expires_at`,
      [outletId, terminalId, prefix, businessDateStr, startSeq, endSeq],
    );
    const expiresAt = reservation.rows[0]?.expires_at ?? new Date(Date.now() + 24 * 3_600_000);

    await recordAudit(client, {
      action: 'receipt_block.reserved',
      result: 'success',
      actorEmployeeId: actor.employeeId,
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { businessDate: businessDateStr, startSeq, endSeq, count: cmd.count },
    });

    const numbers: string[] = [];
    for (let s = startSeq; s <= endSeq; s += 1) {
      numbers.push(formatReceiptNumber(businessDateStr, prefix, s));
    }
    return { businessDate: businessDateStr, numbers, expiresAt: expiresAt.toISOString() };
  });
}

/**
 * Applies a batch of offline-committed bills, ONE TRANSACTION PER BILL (never
 * one transaction for the whole batch), so a single bad item can never roll
 * back its siblings. Every item gets its own success/failure result; nothing
 * is silently dropped.
 */
export async function syncOfflineBills(
  pool: Pool,
  actor: ActorContext,
  cmd: SyncBillsCommand,
  meta: RequestMeta = {},
): Promise<SyncBillsResponse> {
  const { terminalId } = requireOperator(actor);
  if (cmd.bills.length > MAX_SYNC_BATCH) {
    throw new IdentityError(
      'validation',
      `A sync batch may include at most ${String(MAX_SYNC_BATCH)} bills`,
    );
  }
  await checkSyncRateLimit(pool, terminalId);

  const results: SyncBillResult[] = [];
  for (const bill of cmd.bills) {
    try {
      const view = await createBill(pool, actor, bill, meta);
      results.push({
        idempotencyKey: bill.idempotencyKey,
        ok: true,
        billId: view.id,
        receiptNumber: view.receiptNumber,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof IdentityError ? err.code : 'internal';
      results.push({
        idempotencyKey: bill.idempotencyKey,
        ok: false,
        error: message,
        errorCode: code,
      });
    }
  }

  await withActorContext(pool, contextForActor(actor), (client) =>
    recordAudit(client, {
      action: 'sync.batch_processed',
      result: 'success',
      actorEmployeeId: actor.employeeId,
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      ...(actor.outletId ? { outletId: actor.outletId } : {}),
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: {
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    }),
  );

  return { results };
}
