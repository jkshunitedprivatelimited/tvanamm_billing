import { z } from 'zod';

/**
 * Security-relevant audit actions (`advanced-login.md` "Audit Events").
 * Written in the same transaction as the action they describe.
 */
export const auditActionSchema = z.enum([
  'login.succeeded',
  'login.failed',
  'logout',
  'session.expired',
  'session.revoked',
  'otp.sent',
  'otp.verify_failed',
  'mobile.changed',
  'invitation.created',
  'invitation.accepted',
  'invitation.expired',
  'invitation.cancelled',
  'invitation.resent',
  'membership.changed',
  'role.changed',
  'permission.changed',
  'account.disabled',
  'account.reactivated',
  'workspace.selected',
  'employee.created',
  'pin.set',
  'pin.reset',
  'pin.login_failed',
  'pin.locked',
  'terminal.activation_code_issued',
  'terminal.enrolled',
  'terminal.locked',
  'terminal.unlocked',
  'terminal.revoked',
  'terminal.credential_rotated',
  'shift.opened',
  'shift.closed',
  'shift.force_closed',
  'step_up.succeeded',
  'step_up.failed',
  'disabled_account.access_attempt',
]);

export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditResultSchema = z.enum(['success', 'failure', 'denied']);
export type AuditResult = z.infer<typeof auditResultSchema>;

export const auditEventSchema = z.object({
  id: z.uuid(),
  action: auditActionSchema,
  result: auditResultSchema,
  occurredAt: z.iso.datetime(),
  actorUserId: z.uuid().optional(),
  subjectUserId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  franchiseId: z.uuid().optional(),
  outletId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  terminalId: z.uuid().optional(),
  correlationId: z.uuid(),
  /** Safe, non-sensitive metadata only. Never PINs, passwords, tokens, bodies. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

/** Fields a caller supplies; the store fills id/occurredAt. */
export const auditEventInputSchema = auditEventSchema
  .omit({ id: true, occurredAt: true })
  .extend({ metadata: z.record(z.string(), z.unknown()).optional() });

export type AuditEventInput = z.infer<typeof auditEventInputSchema>;
