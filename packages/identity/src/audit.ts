import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@jksh/db';
import type { AuditAction, AuditResult } from '@jksh/contracts';

export interface AuditInput {
  action: AuditAction;
  result: AuditResult;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  organizationId?: string | null;
  franchiseId?: string | null;
  outletId?: string | null;
  sessionId?: string | null;
  terminalId?: string | null;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append a security audit event. Call inside the same transaction as the action
 * it records (`advanced-login.md`). Never pass PINs, passwords, tokens, or full
 * request bodies in `metadata`.
 */
export async function recordAudit(
  client: PoolClient,
  input: AuditInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into audit.auth_events
       (id, action, result, actor_user_id, subject_user_id, organization_id,
        franchise_id, outlet_id, session_id, terminal_id, correlation_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      input.action,
      input.result,
      input.actorUserId ?? null,
      input.subjectUserId ?? null,
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
