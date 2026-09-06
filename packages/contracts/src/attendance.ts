import { z } from 'zod';

export const checkInCommandSchema = z.object({
  deviceTime: z.iso.datetime().optional(),
});
export type CheckInCommand = z.infer<typeof checkInCommandSchema>;

export const checkOutCommandSchema = z.object({
  deviceTime: z.iso.datetime().optional(),
});
export type CheckOutCommand = z.infer<typeof checkOutCommandSchema>;

export const correctAttendanceCommandSchema = z
  .object({
    checkedInAt: z.iso.datetime().optional(),
    checkedOutAt: z.iso.datetime().nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => v.checkedInAt !== undefined || v.checkedOutAt !== undefined, {
    message: 'A correction must change at least one time',
  });
export type CorrectAttendanceCommand = z.infer<typeof correctAttendanceCommandSchema>;

export const setOutletScheduleCommandSchema = z.object({
  expectedStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  expectedEndTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  graceMinutes: z.int().min(0).max(180).default(10),
});
export type SetOutletScheduleCommand = z.infer<typeof setOutletScheduleCommandSchema>;

export const attendanceCorrectionViewSchema = z.object({
  id: z.uuid(),
  correctedCheckedInAt: z.string().nullable(),
  correctedCheckedOutAt: z.string().nullable(),
  reason: z.string(),
  correctedByName: z.string().nullable(),
  correctedAt: z.string(),
});

export const attendanceSessionViewSchema = z.object({
  id: z.uuid(),
  outletId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  businessDate: z.string(),
  checkedInAt: z.string(),
  checkedOutAt: z.string().nullable(),
  status: z.enum(['open', 'closed', 'missing_checkout']),
  isLate: z.boolean(),
  durationMinutes: z.int().nullable(),
  corrections: z.array(attendanceCorrectionViewSchema),
});
export type AttendanceSessionView = z.infer<typeof attendanceSessionViewSchema>;

export const employeeActivitySummarySchema = z.object({
  employeeId: z.uuid(),
  employeeName: z.string(),
  businessDate: z.string(),
  billCount: z.int(),
  discountCount: z.int(),
  refundCount: z.int(),
  firstActivityAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});
export type EmployeeActivitySummary = z.infer<typeof employeeActivitySummarySchema>;
