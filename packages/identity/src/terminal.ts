import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActivationCodeIssued,
  ActorContext,
  IssueActivationCodeCommand,
  RegisterTerminalCommand,
  TerminalRegistered,
  TerminalSummary,
} from '@jksh/contracts';
import { contextForActor, systemContext } from './db-context.js';
import { ensureAllowed } from './authz.js';
import { FRESH_AUTH_SECONDS } from './authorize.js';
import { generateActivationCode, nextReceiptPrefix } from './ids.js';
import { activationCodeMatches, hashActivationCode, mintTerminalCredential } from './tokens.js';
import { recordAudit } from './audit.js';
import { IdentityError } from './errors.js';
import type { RequestMeta } from './admin-auth.js';

interface OutletRow {
  organization_id: string;
  franchise_id: string | null;
  display_name: string;
  status: string;
}

async function loadOutlet(client: PoolClient, outletId: string): Promise<OutletRow> {
  const { rows } = await client.query<OutletRow>(
    `select organization_id, franchise_id, display_name, status
       from billing.outlets where id = $1`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0];
}

export async function issueActivationCode(
  pool: Pool,
  actor: ActorContext,
  cmd: IssueActivationCodeCommand,
  meta: RequestMeta = {},
): Promise<ActivationCodeIssued> {
  const secret = identityTokenSecret();
  const code = generateActivationCode();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + cmd.expiresInMinutes * 60_000);

  await withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await loadOutlet(client, cmd.outletId);
    ensureAllowed(
      actor,
      'identity.terminal.enroll',
      {
        organizationId: outlet.organization_id,
        ...(outlet.franchise_id ? { franchiseId: outlet.franchise_id } : {}),
        outletId: cmd.outletId,
      },
      { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
    );
    if (outlet.status !== 'active') {
      throw new IdentityError('outlet_not_active', 'Outlet must be active to enroll a terminal');
    }
    await client.query(
      `insert into identity.terminal_activation_codes
         (id, outlet_id, organization_id, franchise_id, label, code_hash, expires_at, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        cmd.outletId,
        outlet.organization_id,
        outlet.franchise_id,
        cmd.label,
        hashActivationCode(secret, code),
        expiresAt,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'terminal.activation_code_issued',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { activationCodeId: id, label: cmd.label },
    });
  });

  return { activationCodeId: id, code, outletId: cmd.outletId, expiresAt: expiresAt.toISOString() };
}

/** Device-side. The one-time code is the authority (no prior auth). */
export async function registerTerminal(
  pool: Pool,
  cmd: RegisterTerminalCommand,
  meta: RequestMeta = {},
): Promise<TerminalRegistered> {
  const secret = identityTokenSecret();
  const codeHash = hashActivationCode(secret, cmd.code);

  return withActorContext(pool, systemContext(), async (client) => {
    const { rows: codeRows } = await client.query<{
      id: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string | null;
      code_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `select id, outlet_id, organization_id, franchise_id, code_hash, expires_at, consumed_at
         from identity.terminal_activation_codes where code_hash = $1 for update`,
      [codeHash],
    );
    const codeRow = codeRows[0];
    if (!codeRow || !activationCodeMatches(secret, cmd.code, codeRow.code_hash)) {
      throw new IdentityError('activation_code_invalid', 'Activation code is not valid');
    }
    if (codeRow.consumed_at) throw new IdentityError('activation_code_consumed', 'Code already used');
    if (codeRow.expires_at.getTime() <= Date.now()) {
      throw new IdentityError('activation_code_expired', 'Code has expired');
    }

    const outlet = await loadOutlet(client, codeRow.outlet_id);
    if (outlet.status !== 'active') {
      throw new IdentityError('outlet_not_active', 'Outlet is not active');
    }

    await client.query(`select id from billing.outlets where id = $1 for update`, [codeRow.outlet_id]);

    const replaced = await client.query<{ id: string }>(
      `update identity.terminals
         set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced'
       where outlet_id = $1 and status <> 'revoked'
       returning id`,
      [codeRow.outlet_id],
    );
    for (const prev of replaced.rows) {
      await client.query(
        `update identity.terminal_credentials
           set status = 'revoked', revoked_at = now(), revoked_reason = 'terminal_replaced'
         where terminal_id = $1 and status = 'active'`,
        [prev.id],
      );
      await client.query(
        `update identity.operator_sessions
           set status = 'ended', ended_at = now(), revoked_reason = 'terminal_replaced'
         where terminal_id = $1 and status in ('active','locked')`,
        [prev.id],
      );
    }

    const terminalId = randomUUID();
    const receiptPrefix = nextReceiptPrefix([]);
    await client.query(
      `insert into identity.terminals
         (id, outlet_id, organization_id, franchise_id, name, status, receipt_prefix,
          paper_width_mm, app_version, last_validated_at)
       values ($1,$2,$3,$4,$5,'active',$6,$7,$8, now())`,
      [
        terminalId,
        codeRow.outlet_id,
        codeRow.organization_id,
        codeRow.franchise_id,
        cmd.deviceLabel,
        receiptPrefix,
        cmd.paperWidthMm,
        cmd.appVersion ?? null,
      ],
    );

    const minted = mintTerminalCredential(secret, terminalId);
    await client.query(
      `insert into identity.terminal_credentials (terminal_id, public_id, nonce_hash, version, status)
       values ($1, $2, $3, 1, 'active')`,
      [terminalId, minted.publicId, minted.nonceHash],
    );
    await client.query(
      `update identity.terminal_activation_codes
         set consumed_at = now(), consumed_terminal_id = $2 where id = $1`,
      [codeRow.id, terminalId],
    );

    await recordAudit(client, {
      action: replaced.rowCount ? 'terminal.replaced' : 'terminal.enrolled',
      result: 'success',
      organizationId: codeRow.organization_id,
      franchiseId: codeRow.franchise_id,
      outletId: codeRow.outlet_id,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { receiptPrefix, replaced: replaced.rows.map((r) => r.id) },
    });

    return {
      terminalId,
      organizationId: codeRow.organization_id,
      ...(codeRow.franchise_id ? { franchiseId: codeRow.franchise_id } : {}),
      outletId: codeRow.outlet_id,
      outletName: outlet.display_name,
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
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await loadOutlet(client, outletId);
    ensureAllowed(actor, 'identity.terminal.enroll', {
      organizationId: outlet.organization_id,
      ...(outlet.franchise_id ? { franchiseId: outlet.franchise_id } : {}),
      outletId,
    });
    const { rows } = await client.query<{
      id: string;
      name: string;
      status: TerminalSummary['status'];
      receipt_prefix: string;
      paper_width_mm: number;
      app_version: string | null;
      last_validated_at: Date | null;
      last_synced_at: Date | null;
      enrolled_at: Date;
    }>(
      `select id, name, status, receipt_prefix, paper_width_mm, app_version,
              last_validated_at, last_synced_at, enrolled_at
         from identity.terminals where outlet_id = $1 order by enrolled_at desc`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      outletId,
      outletName: outlet.display_name,
      receiptPrefix: r.receipt_prefix,
      paperWidthMm: r.paper_width_mm,
      ...(r.app_version ? { appVersion: r.app_version } : {}),
      ...(r.last_validated_at ? { lastValidatedAt: r.last_validated_at.toISOString() } : {}),
      ...(r.last_synced_at ? { lastSyncedAt: r.last_synced_at.toISOString() } : {}),
      enrolledAt: r.enrolled_at.toISOString(),
    }));
  });
}

export async function revokeTerminal(
  pool: Pool,
  actor: ActorContext,
  terminalId: string,
  reason: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string;
    }>(
      `select organization_id, franchise_id, outlet_id from identity.terminals where id = $1 for update`,
      [terminalId],
    );
    const row = rows[0];
    if (!row) throw new IdentityError('terminal_not_found', 'Terminal not found');
    ensureAllowed(
      actor,
      'identity.terminal.revoke',
      {
        organizationId: row.organization_id,
        ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
        outletId: row.outlet_id,
      },
      { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
    );

    await client.query(
      `update identity.terminals
         set status = 'revoked', revoked_at = now(), revoked_reason = $2, revoked_by = $3
       where id = $1`,
      [terminalId, reason, actor.accountId ?? null],
    );
    await client.query(
      `update identity.terminal_credentials
         set status = 'revoked', revoked_at = now(), revoked_reason = $2
       where terminal_id = $1 and status = 'active'`,
      [terminalId, reason],
    );
    await client.query(
      `update identity.operator_sessions
         set status = 'ended', ended_at = now(), revoked_reason = 'terminal_revoked'
       where terminal_id = $1 and status in ('active','locked')`,
      [terminalId],
    );
    await recordAudit(client, {
      action: 'terminal.revoked',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      terminalId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { reason },
    });
  });
}
