import { z } from 'zod';
import { employeeStatusSchema, mobileNumberSchema } from './identity.js';

/** Franchise Owner (or Central) creates a Store Employee from name + mobile. */
export const createEmployeeCommandSchema = z.object({
  outletId: z.uuid(),
  fullName: z.string().trim().min(2).max(120),
  mobile: mobileNumberSchema,
  /** Franchise Owner assigns the initial four-digit PIN (advanced-login.md). */
  initialPin: z.string().regex(/^\d{4}$/),
});
export type CreateEmployeeCommand = z.infer<typeof createEmployeeCommandSchema>;

export const employeeCreatedSchema = z.object({
  employeeId: z.uuid(),
  employeeCode: z.string().regex(/^EMP-[A-Z0-9]{6,10}$/),
  outletId: z.uuid(),
  fullName: z.string(),
});
export type EmployeeCreated = z.infer<typeof employeeCreatedSchema>;

export const updateEmployeeCommandSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  mobile: mobileNumberSchema.optional(),
});
export type UpdateEmployeeCommand = z.infer<typeof updateEmployeeCommandSchema>;

export const setEmployeeStatusCommandSchema = z.object({
  status: employeeStatusSchema,
  reason: z.string().trim().max(300).optional(),
});
export type SetEmployeeStatusCommand = z.infer<typeof setEmployeeStatusCommandSchema>;

export const resetPinCommandSchema = z.object({
  newPin: z.string().regex(/^\d{4}$/),
});
export type ResetPinCommand = z.infer<typeof resetPinCommandSchema>;

export const employeeSummarySchema = z.object({
  id: z.uuid(),
  employeeCode: z.string(),
  fullName: z.string(),
  mobile: z.string(),
  outletId: z.uuid(),
  status: employeeStatusSchema,
  pinSet: z.boolean(),
  lockedUntil: z.iso.datetime().optional(),
});
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
