import { z } from 'zod';

export const notificationSeveritySchema = z.enum(['info', 'warning', 'critical']);

/** Categories a user may never mute, regardless of role
 *  (`operational-notifications.md` "mandatory categories cannot be muted"). */
export const MANDATORY_NOTIFICATION_CATEGORIES = [
  'security',
  'financial_integrity',
  'recall',
  'data_loss',
] as const;

export const notificationViewSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  severity: notificationSeveritySchema,
  title: z.string(),
  body: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.uuid().nullable(),
  outletId: z.uuid().nullable(),
  eventCount: z.int(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type NotificationView = z.infer<typeof notificationViewSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationViewSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.int(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const muteCategoryCommandSchema = z.object({
  category: z.string().trim().min(1).max(60),
});
export type MuteCategoryCommand = z.infer<typeof muteCategoryCommandSchema>;
