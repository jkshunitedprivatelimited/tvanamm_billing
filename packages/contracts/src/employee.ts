import { z } from 'zod';

/** Franchise Owner creates a Store Employee from name + phone. */
export const createEmployeeCommandSchema = z.object({
  outletId: z.uuid(),
  fullName: z.string().trim().min(2).max(120),
  /** E.164-ish; kept permissive for Indian mobile formats. */
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{7,17}$/),
  /** Optional initial PIN; if omitted the employee sets it on first use. */
  initialPin: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

export type CreateEmployeeCommand = z.infer<typeof createEmployeeCommandSchema>;

export const employeeCreatedSchema = z.object({
  employeeId: z.string().regex(/^EMP-[A-Z0-9]{6,10}$/),
  userId: z.uuid(),
  outletId: z.uuid(),
  fullName: z.string(),
  pinSet: z.boolean(),
});

export type EmployeeCreated = z.infer<typeof employeeCreatedSchema>;

export const setPinCommandSchema = z
  .object({
    userId: z.uuid(),
    pin: z.string().regex(/^\d{4}$/),
    confirmPin: z.string().regex(/^\d{4}$/),
  })
  .refine((value) => value.pin === value.confirmPin, {
    message: 'PIN entries do not match',
    path: ['confirmPin'],
  });

export type SetPinCommand = z.infer<typeof setPinCommandSchema>;

export const resetPinCommandSchema = z.object({
  userId: z.uuid(),
  newPin: z.string().regex(/^\d{4}$/),
});

export type ResetPinCommand = z.infer<typeof resetPinCommandSchema>;

export const employeeSummarySchema = z.object({
  userId: z.uuid(),
  employeeId: z.string(),
  fullName: z.string(),
  phone: z.string(),
  outletId: z.uuid(),
  accountState: z.enum(['invited', 'active', 'suspended', 'locked', 'disabled']),
  pinSet: z.boolean(),
  lockedUntil: z.iso.datetime().optional(),
});

export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
