import { randomUUID } from 'node:crypto';
import { serverEnvironment } from '@jksh/config';
import { withTransaction, type Pool } from '@jksh/db';
import type {
  ActivationCodeIssued,
  ActorContext,
  IssueActivationCodeCommand,
  RegisterTerminalCommand,
  TerminalRegistered,
  TerminalSummary,
} from '@jksh/contracts';
import { authorize, FRESH_AUTH_SECONDS, type PolicyContext } from './authorize.js';
import { generateActivationCode, nextReceiptPrefix } from './ids.js';
import {
  activationCodeMatches,
  hashActivationCode,
  mintTerminalCredential,
} from './tokens.js';
import { recordAudit } from './audit.js';
import { IdentityError } from './errors.js';
import type { RequestMeta } from './admin-auth.js';

const STEP_UP: PolicyContext = { requireStepUpWithinSeconds: FRESH_AUTH_SECONDS };

interface OutletLocator {
  organization_id: string;
  franchise_id: string;
  name: string;
}

async function locateOutlet(pool: Pool, outletId: string): Promise<OutletLocator> {
  const { rows } = await pool.query<OutletLocator>(
    `select organization_id, franchise_id, name
       from identity.outlets where id = $1 and status = 'active'`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0];
}

function ensureAllowed(
  actor: ActorContext,
  capability: Parameters<typeof authorize>[1],
  scope: Parameters<typeof authorize>[2],
  policy?: PolicyContext,
): void {
  const decision = authorize(actor, capability, scope, policy);
  if (!decision.allowed) {
    throw new IdentityError('forbidden', `Denied: ${decision.reason}`, {
      details: { reason: decision.reason },
    });
  }
}

export async function issueActivationCode(
  pool: Pool,
  actor: ActorContext,
  cmd: IssueActivationCodeCommand,
  meta: RequestMeta = {},
): Promise<ActivationCodeIssued> {
  const outlet = await locateOutlet(pool, cmd.outletId);
  ensureAllowed(
    actor,
    'identity.terminal.enroll',
    { organizationId: outlet.organization_id, franchiseId: outlet.franchise_id, outletId: cmd.outletId },
    STEP_UP,
  );

  const secret = serverEnvironment().identityTokenSecret;
  const code = generateActivationCode();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + cmd.expiresInMinutes * 60_000);

  await withTransaction(pool, async (client) => {
    await client.query(
      `insert into identity.terminal_activation_codes
         (id, outlet_id, organization_id, franchise_id, label, code_hash,
          expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        cmd.outletId,
        outlet.organization_id,
        outlet.franchise_id,
        cmd.label,
        hashActivationCode(secret, code),
        expiresAt,
        actor.userId,
      ],
    );
    await recordAudit(client, {
      action: 'terminal.activation_code_issued',
      result: 'success',
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { activationCodeId: id, label: cmd.label },
    });
  });

  return { activationCodeId: id, code, outletId: cmd.outletId, expiresAt: expiresAt.toISOString() };
}

/**
 * Device-side. No prior authentication: the one-time code is the authority.
 * MVP rule: one active terminal per outlet, so an existing active terminal is
 * revoked as part of registering its replacement.
 */
export async function registerTerminal(
  pool: Pool,
  cmd: RegisterTerminalCommand,
  meta: RequestMeta = {},
): Promise<TerminalRegistered> {
  const secret = serverEnvironment().identityTokenSecret;
  const codeHash = hashActivationCode(secret, cmd.code);

  return withTransaction(pool, async (client) => {
    const { rows: codeRows } = await client.query<{
      id: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string;
      code_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `select id, outlet_id, organization_id, franchise_id, code_hash,
              expires_at, consumed_at
         from identity.terminal_activation_codes
        where code_hash = $1
        for update`,
      [codeHash],
    );
    const codeRow = codeRows[0];
    if (!codeRow || !activationCodeMatches(secret, cmd.code, codeRow.code_hash)) {
      throw new IdentityError('activation_code_invalid', 'Activation code is not valid');
    }
    if (codeRow.consumed_at) {
      throw new IdentityError('activation_code_consumed', 'Activation code already used');
    }
    if (codeRow.expires_at.getTime() <= Date.now()) {
      throw new IdentityError('activation_code_expired', 'Activation code has expired');
    }

    await client.query(`select id from identity.outlets where id = $1 for update`, [
      codeRow.outlet_id,
    ]);

    // Revoke the outlet's current active terminal, its credentials, and any open
    // workstation session (one active terminal per outlet).
    const { rows: replaced } = await client.query<{ id: string }>(
      `update identity.terminals
         set state = 'revoked', revoked_at = now(), revoked_reason = 'replaced'
       where outlet_id = $1 and state <> 'revoked'
       returning id`,
      [codeRow.outlet_id],
    );
    for (const prev of replaced) {
      await client.query(
        `update identity.terminal_credentials
           set state = 'revoked', revoked_at = now(), revoked_reason = 'terminal_replaced'
         where terminal_id = $1 and state = 'active'`,
        [prev.id],
      );
      await client.query(
        `update identity.workstation_sessions
           set state = 'ended', ended_at = now()
         where terminal_id = $1 and state in ('active','locked')`,
        [prev.id],
      );
    }

    const receiptPrefix = nextReceiptPrefix([]); // fresh: prior terminals revoked

    const terminalId = randomUUID();
    await client.query(
      `insert into identity.terminals
         (id, organization_id, franchise_id, outlet_id, label, state,
          receipt_prefix, app_version, last_seen_at, created_at)
       values ($1,$2,$3,$4,$5,'active',$6,$7, now(), now())`,
      [
        terminalId,
        codeRow.organization_id,
        codeRow.franchise_id,
        codeRow.outlet_id,
        cmd.deviceLabel,
        receiptPrefix,
        cmd.appVersion ?? null,
      ],
    );

    const minted = mintTerminalCredential(secret, terminalId);
    await client.query(
      `insert into identity.terminal_credentials (terminal_id, nonce_hash, state)
       values ($1, $2, 'active')`,
      [terminalId, minted.credentialHash],
    );
    await client.query(
      `update identity.terminal_activation_codes
         set consumed_at = now(), consumed_terminal_id = $2
       where id = $1`,
      [codeRow.id, terminalId],
    );

    const { rows: outletRows } = await client.query<{ name: string }>(
      `select name from identity.outlets where id = $1`,
      [codeRow.outlet_id],
    );

    await recordAudit(client, {
      action: 'terminal.enrolled',
      result: 'success',
      organizationId: codeRow.organization_id,
      franchiseId: codeRow.franchise_id,
      outletId: codeRow.outlet_id,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { label: cmd.deviceLabel, receiptPrefix, replaced: replaced.map((r) => r.id) },
    });

    return {
      terminalId,
      organizationId: codeRow.organization_id,
      franchiseId: codeRow.franchise_id,
      outletId: codeRow.outlet_id,
      outletName: outletRows[0]?.name ?? '',
      terminalCredential: minted.credential,
      receiptPrefix,
    };
  });
}

export async function listTerminals(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<TerminalSummary[]> {
  const outlet = await locateOutlet(pool, outletId);
  ensureAllowed(actor, 'identity.terminal.enroll', {
    organizationId: outlet.organization_id,
    franchiseId: outlet.franchise_id,
    outletId,
  });

  const { rows } = await pool.query<{
    id: string;
    label: string;
    state: TerminalSummary['state'];
    receipt_prefix: string;
    app_version: string | null;
    last_seen_at: Date | null;
    created_at: Date;
  }>(
    `select id, label, state, receipt_prefix, app_version, last_seen_at, created_at
       from identity.terminals where outlet_id = $1 order by created_at desc`,
    [outletId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    state: row.state,
    outletId,
    outletName: outlet.name,
    receiptPrefix: row.receipt_prefix,
    ...(row.app_version ? { appVersion: row.app_version } : {}),
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function revokeTerminal(
  pool: Pool,
  actor: ActorContext,
  terminalId: string,
  reason: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      organization_id: string;
      franchise_id: string;
      outlet_id: string;
    }>(
      `select organization_id, franchise_id, outlet_id
         from identity.terminals where id = $1 for update`,
      [terminalId],
    );
    const row = rows[0];
    if (!row) throw new IdentityError('terminal_not_found', 'Terminal not found');

    ensureAllowed(
      actor,
      'identity.terminal.revoke',
      { organizationId: row.organization_id, franchiseId: row.franchise_id, outletId: row.outlet_id },
      STEP_UP,
    );

    await client.query(
      `update identity.terminals
         set state = 'revoked', revoked_at = now(), revoked_reason = $2
       where id = $1`,
      [terminalId, reason],
    );
    await client.query(
      `update identity.terminal_credentials
         set state = 'revoked', revoked_at = now(), revoked_reason = $2
       where terminal_id = $1 and state = 'active'`,
      [terminalId, reason],
    );
    await client.query(
      `update identity.workstation_sessions
         set state = 'ended', ended_at = now()
       where terminal_id = $1 and state in ('active','locked')`,
      [terminalId],
    );
    await recordAudit(client, {
      action: 'terminal.revoked',
      result: 'success',
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { reason },
    });
  });
}
