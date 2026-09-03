import { z } from 'zod';

export const terminalStatusSchema = z.enum(['pending', 'active', 'locked', 'revoked']);
export type TerminalStatus = z.infer<typeof terminalStatusSchema>;

/** Franchise Owner (or Central for jksh_owned) issues a one-time activation code. */
export const issueActivationCodeCommandSchema = z.object({
  outletId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});
export type IssueActivationCodeCommand = z.infer<typeof issueActivationCodeCommandSchema>;

export const activationCodeIssuedSchema = z.object({
  activationCodeId: z.uuid(),
  code: z.string(),
  outletId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
export type ActivationCodeIssued = z.infer<typeof activationCodeIssuedSchema>;

export const registerTerminalCommandSchema = z.object({
  code: z.string().trim().min(6).max(40),
  deviceLabel: z.string().trim().min(1).max(120),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  appVersion: z.string().max(40).optional(),
});
export type RegisterTerminalCommand = z.infer<typeof registerTerminalCommandSchema>;

export const terminalRegisteredSchema = z.object({
  terminalId: z.uuid(),
  organizationId: z.uuid(),
  franchiseId: z.uuid().optional(),
  outletId: z.uuid(),
  outletName: z.string(),
  terminalCredential: z.string(),
  receiptPrefix: z.string().regex(/^T\d{2}$/),
});
export type TerminalRegistered = z.infer<typeof terminalRegisteredSchema>;

export const terminalSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: terminalStatusSchema,
  outletId: z.uuid(),
  outletName: z.string(),
  receiptPrefix: z.string(),
  paperWidthMm: z.number(),
  appVersion: z.string().optional(),
  lastValidatedAt: z.iso.datetime().optional(),
  lastSyncedAt: z.iso.datetime().optional(),
  enrolledAt: z.iso.datetime(),
});
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;

export const revokeTerminalCommandSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});
export type RevokeTerminalCommand = z.infer<typeof revokeTerminalCommandSchema>;
