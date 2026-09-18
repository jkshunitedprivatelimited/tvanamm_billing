import { z } from 'zod';

export const paymentMethodSchema = z.enum(['cash', 'upi']);
export const refundKindSchema = z.enum(['full', 'partial']);

export const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/);
export const receiptNumberSchema = z.string().regex(/^\d{8}-T\d{2}-\d{6}$/);

export const discountInputSchema = z.object({
  kind: z.enum(['fixed', 'percent']),
  value: moneySchema,
  reason: z.string().trim().min(1).max(500),
});
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const billAddonInputSchema = z.object({
  addonId: z.uuid(),
  quantity: z.int().positive().max(99),
});

const billLineInputShape = z.object({
  /** client-side temp id, echoed back for cart reconciliation */
  clientLineId: z.string().min(1).max(64).optional(),
  catalogItemId: z.uuid().optional(),
  /** present instead of catalogItemId => a combo, exploded server-side into
   *  one bill line per component with a proportionally-allocated price
   *  (`menu-publishing.md` "Billing proportionally allocates combo value and
   *  discounts across component sale lines"). A combo line has no add-ons of
   *  its own in this pass - its components are a fixed bundle. */
  comboId: z.uuid().optional(),
  quantity: z.int().positive().max(999),
  addons: z.array(billAddonInputSchema).max(30).optional(),
  note: z.string().trim().max(500).optional(),
  lineDiscount: discountInputSchema.optional(),
});
export const billLineInputSchema = billLineInputShape
  .refine((v) => !!v.catalogItemId !== !!v.comboId, {
    message: 'A bill line needs exactly one of catalogItemId or comboId',
  })
  .refine((v) => !v.comboId || !v.addons || v.addons.length === 0, {
    message: 'A combo line cannot select its own add-ons',
  })
  .refine((v) => !v.comboId || !v.lineDiscount, {
    message:
      'A combo line has no discount of its own in this pass - apply a bill-level discount instead',
  });
export type BillLineInput = z.infer<typeof billLineInputShape>;

const createBillCommandShape = z.object({
  idempotencyKey: z.string().min(16).max(200),
  /** the published outlet menu version the cart was priced against */
  menuVersion: z.string().regex(/^\d+$/),
  paymentMethod: paymentMethodSchema.nullable(),
  paymentReference: z.string().trim().max(200).optional(),
  customer: z
    .object({
      name: z.string().trim().max(160).optional(),
      mobile: z
        .string()
        .trim()
        .regex(/^\+?[0-9]{8,15}$/)
        .optional(),
    })
    .optional(),
  lines: z.array(billLineInputSchema).min(1).max(200),
  billDiscount: discountInputSchema.optional(),
  terminalOccurredAt: z.iso.datetime(),
  offline: z.boolean().optional(),
  /** offline only: a receipt number pre-allocated from the device's block */
  terminalReceiptNumber: receiptNumberSchema.optional(),
  /** offline only: the signed bundle issued while the terminal was last online */
  offlineAuthBundle: z.string().min(1).optional(),
  /** offline only: which of the bundle's covered employees actually rang up
   *  this sale on the device - the bill is attributed to this employee, not
   *  to whoever is logged in when the terminal later syncs. */
  offlineEmployeeId: z.uuid().optional(),
});

export const createBillCommandSchema = createBillCommandShape.refine(
  (v) =>
    !v.offline || (!!v.terminalReceiptNumber && !!v.offlineAuthBundle && !!v.offlineEmployeeId),
  {
    message:
      'An offline bill needs a pre-allocated receipt number, an offline authorization, and the employee who rang it up',
  },
);
export type CreateBillCommand = z.infer<typeof createBillCommandShape>;

export const billLineViewSchema = z.object({
  id: z.uuid(),
  lineNo: z.int(),
  catalogItemId: z.uuid(),
  itemName: z.string(),
  quantity: z.int(),
  unitPrice: moneySchema,
  gstRate: moneySchema,
  baseTotal: moneySchema,
  discount: moneySchema,
  finalTotal: moneySchema,
  note: z.string().nullable(),
  refundedQuantity: z.int(),
  /** Set when this line is one exploded component of a combo purchase, so
   *  the UI can group sibling lines under one heading. */
  comboId: z.uuid().nullable(),
  comboName: z.string().nullable(),
  comboGroupId: z.uuid().nullable(),
  /** Set when a scheduled offer auto-discounted this line; `offerDiscount`
   *  is that offer's rupee amount, distinct from any employee discount. */
  offerLabel: z.string().nullable(),
  offerDiscount: moneySchema,
  addons: z.array(
    z.object({
      addonId: z.uuid(),
      addonName: z.string(),
      quantity: z.int(),
      unitPrice: moneySchema,
      total: moneySchema,
    }),
  ),
});

export const billStatusSchema = z.enum(['completed', 'partially_refunded', 'fully_refunded']);

export const billViewSchema = z.object({
  id: z.uuid(),
  outletId: z.uuid(),
  receiptNumber: receiptNumberSchema,
  businessDate: z.string(),
  menuVersion: z.string(),
  employeeName: z.string(),
  customerName: z.string().nullable(),
  customerMobile: z.string().nullable(),
  subtotal: moneySchema,
  discountTotal: moneySchema,
  preRoundTotal: moneySchema,
  roundAdjustment: moneySchema,
  finalTotal: moneySchema,
  paymentMethod: paymentMethodSchema.nullable(),
  paymentReference: z.string().nullable(),
  isComplimentary: z.boolean(),
  isOffline: z.boolean(),
  committedAt: z.string(),
  status: billStatusSchema,
  remainingRefundable: moneySchema,
  lines: z.array(billLineViewSchema),
});
export type BillView = z.infer<typeof billViewSchema>;

export const refundLineInputSchema = z.object({
  billLineId: z.uuid(),
  quantity: z.int().positive(),
});

export const createRefundCommandSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  billId: z.uuid(),
  kind: refundKindSchema,
  payoutMethod: paymentMethodSchema,
  reason: z.string().trim().min(1).max(500),
  payoutReference: z.string().trim().max(200).optional(),
  /** required (and only used) when kind = 'partial' */
  lines: z.array(refundLineInputSchema).max(200).optional(),
});
export type CreateRefundCommand = z.infer<typeof createRefundCommandSchema>;

export const refundViewSchema = z.object({
  id: z.uuid(),
  billId: z.uuid(),
  kind: refundKindSchema,
  amount: moneySchema,
  payoutMethod: paymentMethodSchema,
  payoutReference: z.string().nullable(),
  reason: z.string(),
  actorName: z.string(),
  createdAt: z.string(),
  lines: z.array(z.object({ billLineId: z.uuid(), quantity: z.int(), amount: moneySchema })),
});
export type RefundView = z.infer<typeof refundViewSchema>;

export const printAttemptCommandSchema = z.object({
  result: z.enum(['success', 'failed']),
  reason: z.string().trim().max(500).optional(),
});
export type PrintAttemptCommand = z.infer<typeof printAttemptCommandSchema>;

/** Customer-facing receipt data only - no employee name, no discount/refund
 *  reasons, no internal ids, no GST rate/CGST/SGST breakout
 *  (`receipt-printing.md` "Confirmed Customer Receipt Content"). */
export const receiptSnapshotSchema = z.object({
  outletName: z.string(),
  outletAddress: z.string(),
  outletPhone: z.string().nullable(),
  gstin: z.string().nullable(),
  receiptNumber: receiptNumberSchema,
  businessDate: z.string(),
  committedAt: z.string(),
  lines: z.array(
    z.object({
      itemName: z.string(),
      quantity: z.int(),
      unitPrice: moneySchema,
      discount: moneySchema,
      finalTotal: moneySchema,
      note: z.string().nullable(),
      comboName: z.string().nullable(),
      offerLabel: z.string().nullable(),
      addons: z.array(
        z.object({ addonName: z.string(), quantity: z.int(), unitPrice: moneySchema }),
      ),
    }),
  ),
  subtotal: moneySchema,
  discountTotal: moneySchema,
  roundAdjustment: moneySchema,
  finalTotal: moneySchema,
  paymentMethod: paymentMethodSchema.nullable(),
  isComplimentary: z.boolean(),
});
export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>;
