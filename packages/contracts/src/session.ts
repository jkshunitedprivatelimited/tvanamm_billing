import { z } from 'zod';
import { mobileNumberSchema } from './identity.js';

// --- Admin login: Supabase Auth mobile OTP (MSG91 delivers the SMS) --------

export const requestOtpCommandSchema = z.object({
  phone: mobileNumberSchema,
});
export type RequestOtpCommand = z.infer<typeof requestOtpCommandSchema>;

export const requestOtpResultSchema = z.object({
  sent: z.literal(true),
  resendAvailableInSeconds: z.number().int().nonnegative(),
});
export type RequestOtpResult = z.infer<typeof requestOtpResultSchema>;

export const verifyOtpCommandSchema = z.object({
  phone: mobileNumberSchema,
  code: z.string().regex(/^\d{4,8}$/),
  deviceLabel: z.string().max(120).optional(),
});
export type VerifyOtpCommand = z.infer<typeof verifyOtpCommandSchema>;

export const adminLoginResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('single_workspace'),
    membershipId: z.uuid(),
    redirectTo: z.string(),
  }),
  z.object({ outcome: z.literal('select_workspace') }),
  z.object({
    outcome: z.literal('rejected'),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
]);
export type AdminLoginResult = z.infer<typeof adminLoginResultSchema>;

export const selectWorkspaceCommandSchema = z.object({
  membershipId: z.uuid(),
});
export type SelectWorkspaceCommand = z.infer<typeof selectWorkspaceCommandSchema>;

// --- Store operator login: four-digit PIN on a registered terminal --------

export const operatorSessionStatusSchema = z.enum(['active', 'locked', 'ended']);
export type OperatorSessionStatus = z.infer<typeof operatorSessionStatusSchema>;

export const pinLoginCommandSchema = z.object({
  terminalCredential: z.string().min(20).max(400),
  pin: z.string().regex(/^\d{4}$/),
  deviceLabel: z.string().max(120).optional(),
});
export type PinLoginCommand = z.infer<typeof pinLoginCommandSchema>;

export const pinLoginResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('resolved'),
    operatorSessionId: z.uuid(),
    employeeId: z.string(),
    employeeName: z.string(),
    outletId: z.uuid(),
    outletName: z.string(),
  }),
  z.object({
    outcome: z.literal('rejected'),
    reason: z.enum(['invalid', 'locked', 'terminal_revoked', 'employee_inactive', 'outlet_inactive']),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
  }),
]);
export type PinLoginResult = z.infer<typeof pinLoginResultSchema>;

// --- Franchise Owner onboarding invitation -------------------------------

export const createInvitationCommandSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: mobileNumberSchema,
  franchiseId: z.uuid(),
  email: z.email().optional(),
});
export type CreateInvitationCommand = z.infer<typeof createInvitationCommandSchema>;

export const acceptInvitationCommandSchema = z.object({
  token: z.string().min(20).max(400),
});
export type AcceptInvitationCommand = z.infer<typeof acceptInvitationCommandSchema>;
