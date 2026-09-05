import { z } from 'zod';
import { moneySchema } from './billing';

/** GST rate as a percent string, 0 <= r < 100, up to two decimals. */
export const gstRateSchema = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/)
  .refine((v) => Number(v) < 100, 'GST rate must be below 100');

export const catalogStatusSchema = z.enum(['draft', 'active', 'archived']);

export const createCategoryCommandSchema = z.object({
  brandId: z.uuid(),
  outletId: z.uuid().optional(), // present => franchise-owned private category
  name: z.string().trim().min(1).max(120),
  displayOrder: z.int().min(0).max(9999).default(0),
});
export type CreateCategoryCommand = z.infer<typeof createCategoryCommandSchema>;

export const createAddonGroupCommandSchema = z.object({
  brandId: z.uuid(),
  outletId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  minSelect: z.int().min(0).max(50).default(0),
  maxSelect: z.int().min(1).max(50).default(1),
  isRequired: z.boolean().default(false),
  addons: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        price: moneySchema,
        gstRate: gstRateSchema,
      }),
    )
    .min(1)
    .max(50),
});
export type CreateAddonGroupCommand = z.infer<typeof createAddonGroupCommandSchema>;

const createCatalogItemCommandShape = z.object({
  brandId: z.uuid(),
  outletId: z.uuid().optional(), // present => franchise-owned private item
  categoryId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.url().max(2000).optional(),
  hsnCode: z.string().trim().max(20).optional(),
  gstRate: gstRateSchema.optional(),
  /** Required instead of `gstRate`/`hsnCode` for a Franchise-created (outlet)
   *  item - Central is the tax-profile authority, so master items keep
   *  entering GST/HSN directly (`menu-publishing.md` "GST/HSN comes from a
   *  Central-approved tax profile rather than an arbitrary rate entered at
   *  the outlet"). */
  taxProfileId: z.uuid().optional(),
  price: moneySchema, // GST-inclusive
  isAvailable: z.boolean().default(true),
  offlineSaleAllowed: z.boolean().default(true),
  addonGroupIds: z.array(z.uuid()).max(30).default([]),
});

export const createCatalogItemCommandSchema = createCatalogItemCommandShape.refine(
  (v) => (v.outletId ? !!v.taxProfileId && !v.gstRate : !!v.gstRate && !v.taxProfileId),
  {
    message:
      'A master item sets gstRate directly; a Franchise-created outlet item must reference a taxProfileId instead',
  },
);
export type CreateCatalogItemCommand = z.infer<typeof createCatalogItemCommandShape>;

export const updateCatalogItemCommandSchema = createCatalogItemCommandShape
  .partial()
  .omit({ brandId: true, outletId: true });
export type UpdateCatalogItemCommand = z.infer<typeof updateCatalogItemCommandSchema>;

/** Field-level outlet override. Any omitted field inherits from master. */
export const upsertOutletItemOverrideCommandSchema = z
  .object({
    outletId: z.uuid(),
    catalogItemId: z.uuid(),
    name: z.string().trim().min(1).max(160).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    imageUrl: z.url().max(2000).nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    price: moneySchema.nullable().optional(),
    gstRate: gstRateSchema.nullable().optional(),
    isAvailable: z.boolean().nullable().optional(),
    availabilityNote: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.imageUrl !== undefined ||
      v.categoryId !== undefined ||
      v.price !== undefined ||
      v.gstRate !== undefined ||
      v.isAvailable !== undefined ||
      v.availabilityNote !== undefined,
    'At least one override field is required',
  );
export type UpsertOutletItemOverrideCommand = z.infer<typeof upsertOutletItemOverrideCommandSchema>;

/** A narrow "pause/unpause for sale" toggle - the one catalog write a Store
 *  Employee may make, scoped to their own active outlet
 *  (`menu-publishing.md` "Employee active-outlet pause"). Never touches name,
 *  price, or GST. */
export const pauseOutletItemCommandSchema = z.object({
  outletId: z.uuid(),
  catalogItemId: z.uuid(),
  isAvailable: z.boolean(),
  availabilityNote: z.string().trim().max(500).nullable().optional(),
});
export type PauseOutletItemCommand = z.infer<typeof pauseOutletItemCommandSchema>;

export const OVERRIDABLE_FIELDS = [
  'name',
  'description',
  'image_url',
  'category',
  'price',
  'availability',
] as const;
export const forcedFieldSchema = z.enum(OVERRIDABLE_FIELDS);

export const previewPublicationCommandSchema = z.object({
  brandId: z.uuid(),
  scope: z.enum(['master', 'outlet']),
  originOutletId: z.uuid().optional(), // required when scope = 'outlet'
  targetOutletIds: z.array(z.uuid()).max(500).optional(), // omitted => all brand outlets (master scope)
  overwritePrice: z.boolean().default(false),
  forcedFields: z.array(forcedFieldSchema).max(6).default([]),
});
export type PreviewPublicationCommand = z.infer<typeof previewPublicationCommandSchema>;

export const createPublicationCommandSchema = previewPublicationCommandSchema.extend({
  notes: z.string().trim().max(1000).optional(),
});
export type CreatePublicationCommand = z.infer<typeof createPublicationCommandSchema>;

export const copyOutletItemToMasterCommandSchema = z.object({
  outletItemId: z.uuid(),
  brandId: z.uuid(),
  name: z.string().trim().min(1).max(160).optional(),
  categoryId: z.uuid().optional(),
  price: moneySchema.optional(),
  gstRate: gstRateSchema.optional(),
});
export type CopyOutletItemToMasterCommand = z.infer<typeof copyOutletItemToMasterCommandSchema>;

// ---- Combos ------------------------------------------------------------
// `menu-publishing.md` "Central and Franchise Owners may create combos
// within their scope. A combo references existing component items and their
// recipes instead of owning a duplicate recipe." A combo has its own
// GST-inclusive selling price but no gst_rate/hsn_code of its own - those
// live on its components, proportionally allocated at sale time.

export const comboComponentInputSchema = z.object({
  catalogItemId: z.uuid(),
  quantity: z.int().positive().max(20),
});
export type ComboComponentInput = z.infer<typeof comboComponentInputSchema>;

export const createComboCommandSchema = z.object({
  brandId: z.uuid(),
  outletId: z.uuid().optional(), // present => franchise-owned private combo
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.url().max(2000).optional(),
  price: moneySchema, // GST-inclusive
  isAvailable: z.boolean().default(true),
  offlineSaleAllowed: z.boolean().default(true),
  components: z.array(comboComponentInputSchema).min(2).max(20),
});
export type CreateComboCommand = z.infer<typeof createComboCommandSchema>;

export const updateComboCommandSchema = createComboCommandSchema
  .partial()
  .omit({ brandId: true, outletId: true });
export type UpdateComboCommand = z.infer<typeof updateComboCommandSchema>;

// ---- Read models -----------------------------------------------------------

export const posMenuAddonSchema = z.object({
  addonId: z.uuid(),
  groupId: z.uuid(),
  groupName: z.string(),
  name: z.string(),
  price: moneySchema,
  gstRate: gstRateSchema,
  minSelect: z.int(),
  maxSelect: z.int(),
  isRequired: z.boolean(),
  isAvailable: z.boolean(),
});

export const posMenuItemSchema = z.object({
  catalogItemId: z.uuid(),
  categoryName: z.string(),
  categoryOrder: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  gstRate: gstRateSchema,
  price: moneySchema,
  isAvailable: z.boolean(),
  availabilityNote: z.string().nullable(),
  offlineSaleAllowed: z.boolean(),
  stockRecipeId: z.uuid().nullable(),
  stockRecipeVersion: z.int().nullable(),
  addons: z.array(posMenuAddonSchema),
});

export const posComboComponentSnapshotSchema = z.object({
  catalogItemId: z.uuid(),
  name: z.string(),
  unitPrice: moneySchema,
  gstRate: gstRateSchema,
  quantity: z.int(),
  stockRecipeId: z.uuid().nullable(),
  stockRecipeVersion: z.int().nullable(),
});

export const posComboSnapshotSchema = z.object({
  comboId: z.uuid(),
  categoryName: z.string(),
  categoryOrder: z.int(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: moneySchema,
  isAvailable: z.boolean(),
  availabilityNote: z.string().nullable(),
  offlineSaleAllowed: z.boolean(),
  components: z.array(posComboComponentSnapshotSchema),
});

export const posMenuSnapshotSchema = z.object({
  outletId: z.uuid(),
  version: z.string(), // bigint as string
  checksum: z.string(),
  itemCount: z.int(),
  publishedAt: z.string(),
  items: z.array(posMenuItemSchema),
  combos: z.array(posComboSnapshotSchema).default([]),
});
export type PosMenuSnapshot = z.infer<typeof posMenuSnapshotSchema>;
