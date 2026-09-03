import { z } from 'zod';

/**
 * Terminal state (`advanced-login.md`):
 *   pending -> active -> locked -> active
 *                     -> revoked
 */
export const terminalStateSchema = z.enum([
  'pending',
  'active',
  'locked',
  'revoked',
]);

export type TerminalState = z.infer<typeof terminalStateSchema>;

/** Admin/manager issues a one-time activation code bound to an outlet. */
export const issueActivationCodeCommandSchema = z.object({
  outletId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  /** Minutes until the code expires if unused. */
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});

export type IssueActivationCodeCommand = z.infer<
  typeof issueActivationCodeCommandSchema
>;

export const activationCodeIssuedSchema = z.object({
  activationCodeId: z.uuid(),
  /** Shown once to the manager, never stored in clear text. */
  code: z.string(),
  outletId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

export type ActivationCodeIssued = z.infer<typeof activationCodeIssuedSchema>;

/** Device redeems the activation code to become a registered terminal. */
export const registerTerminalCommandSchema = z.object({
  code: z.string().trim().min(6).max(40),
  deviceLabel: z.string().trim().min(1).max(120),
  appVersion: z.string().max(40).optional(),
});

export type RegisterTerminalCommand = z.infer<
  typeof registerTerminalCommandSchema
>;

export const terminalRegisteredSchema = z.object({
  terminalId: z.uuid(),
  organizationId: z.uuid(),
  franchiseId: z.uuid(),
  outletId: z.uuid(),
  outletName: z.string(),
  /** Opaque long-lived credential; server stores only its hash. */
  terminalCredential: z.string(),
  receiptPrefix: z.string().regex(/^T\d{2}$/),
});

export type TerminalRegistered = z.infer<typeof terminalRegisteredSchema>;

export const terminalSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  state: terminalStateSchema,
  outletId: z.uuid(),
  outletName: z.string(),
  receiptPrefix: z.string(),
  appVersion: z.string().optional(),
  lastSeenAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
});

export type TerminalSummary = z.infer<typeof terminalSummarySchema>;
