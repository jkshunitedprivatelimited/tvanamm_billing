import { z } from 'zod';

/**
 * Authentication session state (`advanced-login.md`):
 *   created -> active -> expired
 *                     -> revoked
 *                     -> step-up-required -> active
 */
export const sessionStateSchema = z.enum([
  'active',
  'step_up_required',
  'expired',
  'revoked',
]);

export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionKindSchema = z.enum(['admin', 'store_pin']);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const deviceInfoSchema = z.object({
  userAgent: z.string().max(500).optional(),
  ip: z.string().max(64).optional(),
  label: z.string().max(120).optional(),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  kind: sessionKindSchema,
  state: sessionStateSchema,
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
  device: deviceInfoSchema,
  current: z.boolean(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

// --- Admin login: mobile number + SMS OTP -------------------------------------
// Confirmed primary (and only) authentication method for Central Admin,
// Accountant, and Franchise Owner (`advanced-login.md`).

/** E.164 mobile number, e.g. +919876543210. */
export const mobileNumberSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const startOtpCommandSchema = z.object({
  phone: mobileNumberSchema,
});

export type StartOtpCommand = z.infer<typeof startOtpCommandSchema>;

export const startOtpResultSchema = z.object({
  // Deliberately generic; the same shape whether or not the number is known.
  sent: z.literal(true),
  resendAvailableInSeconds: z.number().int().nonnegative(),
});

export type StartOtpResult = z.infer<typeof startOtpResultSchema>;

export const verifyOtpCommandSchema = z.object({
  phone: mobileNumberSchema,
  code: z.string().regex(/^\d{4,8}$/),
  deviceLabel: z.string().max(120).optional(),
});

export type VerifyOtpCommand = z.infer<typeof verifyOtpCommandSchema>;

export const adminLoginResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('single_workspace'),
    sessionId: z.uuid(),
    membershipId: z.uuid(),
    redirectTo: z.string(),
  }),
  z.object({
    outcome: z.literal('select_workspace'),
    sessionId: z.uuid(),
  }),
  z.object({
    // Deliberately generic to prevent account enumeration.
    outcome: z.literal('rejected'),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
]);

export type AdminLoginResult = z.infer<typeof adminLoginResultSchema>;

export const selectWorkspaceCommandSchema = z.object({
  membershipId: z.uuid(),
});

export type SelectWorkspaceCommand = z.infer<typeof selectWorkspaceCommandSchema>;

// --- Store PIN login --------------------------------------------------------

export const pinLoginCommandSchema = z.object({
  /** Opaque registered-terminal credential held by the device. */
  terminalCredential: z.string().min(20).max(400),
  pin: z.string().regex(/^\d{4}$/),
  deviceLabel: z.string().max(120).optional(),
});

export type PinLoginCommand = z.infer<typeof pinLoginCommandSchema>;

export const pinLoginResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('resolved'),
    sessionId: z.uuid(),
    workstationSessionId: z.uuid(),
    employeeId: z.string(),
    employeeName: z.string(),
    outletId: z.uuid(),
    outletName: z.string(),
  }),
  z.object({
    outcome: z.literal('rejected'),
    /** Only ever a coarse, non-enumerating reason. */
    reason: z.enum(['invalid', 'locked', 'terminal_revoked', 'offline_expired']),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
]);

export type PinLoginResult = z.infer<typeof pinLoginResultSchema>;

// --- Franchise Owner onboarding invitation ---------------------------------

export const acceptInvitationCommandSchema = z.object({
  token: z.string().min(20).max(400),
  phone: mobileNumberSchema,
  code: z.string().regex(/^\d{4,8}$/),
});

export type AcceptInvitationCommand = z.infer<typeof acceptInvitationCommandSchema>;
