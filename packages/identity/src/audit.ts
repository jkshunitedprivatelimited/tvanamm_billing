import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { AuditAction, AuditResult } from '@jksh/contracts';
import { systemContext } from './db-context';

type Ref = string | null | undefined;

export interface AuditInput {
  action: AuditAction;
  result: AuditResult;
  actorAccountId?: Ref;
  actorEmployeeId?: Ref;
  subjectId?: Ref;
  organizationId?: Ref;
  franchiseId?: Ref;
  outletId?: Ref;
  sessionId?: Ref;
  terminalId?: Ref;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a security audit event. Call inside the same transaction as the action
 * it records. Never pass PINs, OTP codes, tokens, or full request bodies.
 */
export async function recordAudit(client: PoolClient, input: AuditInput): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into audit.events
       (id, action, result, actor_account_id, actor_employee_id, subject_id,
        organization_id, franchise_id, outlet_id, session_id, terminal_id,
        correlation_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      input.action,
      input.result,
      input.actorAccountId ?? null,
      input.actorEmployeeId ?? null,
      input.subjectId ?? null,
      input.organizationId ?? null,
      input.franchiseId ?? null,
      input.outletId ?? null,
      input.sessionId ?? null,
      input.terminalId ?? null,
      input.correlationId ?? randomUUID(),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}

/**
 * Record a denied/failed sensitive command in its OWN transaction, so the
 * denial audit survives even when the business transaction rolls back
 * (`docs/plans/stage-1-audit-remediation.md` P2 Audit Completeness).
 */
export async function auditOutOfBand(pool: Pool, input: AuditInput): Promise<void> {
  await withActorContext(pool, systemContext(), (client) => recordAudit(client, input));
}
