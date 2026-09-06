import { z } from 'zod';
import { gstRateSchema } from './catalog';
import { moneySchema } from './billing';

export const importKindSchema = z.enum(['menu_item', 'expense_category']);

/** A menu-item row keyed by a stable business code (`name`), not a UUID
 *  (`bulk-import-and-data-quality.md` "Resolve references through stable
 *  business codes, not raw database UUIDs"). */
export const menuItemImportRowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  categoryName: z.string().trim().max(120).optional(),
  price: moneySchema,
  gstRate: gstRateSchema,
  hsnCode: z.string().trim().max(20).optional(),
  /** Defaults to available when omitted (applied in the import processor). */
  isAvailable: z.boolean().optional(),
});
export type MenuItemImportRow = z.infer<typeof menuItemImportRowSchema>;

export const expenseCategoryImportRowSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type ExpenseCategoryImportRow = z.infer<typeof expenseCategoryImportRowSchema>;

export const previewImportCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('menu_item'),
    brandId: z.uuid(),
    rows: z.array(menuItemImportRowSchema).min(1).max(500),
  }),
  z.object({
    kind: z.literal('expense_category'),
    brandId: z.uuid().optional(),
    rows: z.array(expenseCategoryImportRowSchema).min(1).max(500),
  }),
]);
export type PreviewImportCommand = z.infer<typeof previewImportCommandSchema>;

export const confirmImportCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('menu_item'),
    brandId: z.uuid(),
    templateVersion: z.string().trim().min(1).max(40),
    fileChecksum: z.string().trim().max(200).optional(),
    rows: z.array(menuItemImportRowSchema).min(1).max(500),
  }),
  z.object({
    kind: z.literal('expense_category'),
    brandId: z.uuid().optional(),
    templateVersion: z.string().trim().min(1).max(40),
    fileChecksum: z.string().trim().max(200).optional(),
    rows: z.array(expenseCategoryImportRowSchema).min(1).max(500),
  }),
]);
export type ConfirmImportCommand = z.infer<typeof confirmImportCommandSchema>;

export const importRowResultSchema = z.object({
  rowNumber: z.int(),
  businessKey: z.string(),
  action: z.enum(['create', 'update', 'skip', 'error']),
  error: z.string().nullable(),
  createdEntityId: z.uuid().nullable(),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importPreviewSchema = z.object({
  kind: importKindSchema,
  rowCount: z.int(),
  createCount: z.int(),
  updateCount: z.int(),
  skipCount: z.int(),
  errorCount: z.int(),
  rows: z.array(importRowResultSchema),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importJobSchema = importPreviewSchema.extend({
  id: z.uuid(),
  status: z.enum(['previewed', 'processing', 'completed', 'partial', 'failed']),
  templateVersion: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;
