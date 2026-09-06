import { z } from 'zod';

/**
 * Cross-system event contracts. Billing writes these to its outbox in the bill
 * transaction; a relay POSTs them to Stock, which lands each one exactly once in
 * `stock_inbox.events` keyed by `eventId`
 * (`docs/architecture/billing-stock-recipe-contract.md` "Sale Event").
 */

export const stockInboundEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.enum(['SaleCompleted', 'SaleRefunded']),
  eventVersion: z.int().positive(),
  occurredAt: z.iso.datetime(),
  source: z.literal('billing'),
  correlationId: z.uuid(),
  organizationId: z.uuid(),
  franchiseId: z.uuid().nullable(),
  outletId: z.uuid(),
  /** HMAC-SHA256 of the canonical payload; verified before processing. */
  signature: z.string().min(1).optional(),
  payload: z.unknown(),
});

export type StockInboundEnvelope = z.infer<typeof stockInboundEnvelopeSchema>;

export const saleCompletedAddonSchema = z.object({
  addonId: z.uuid(),
  quantity: z.number().int().positive(),
  stockRecipeId: z.uuid().nullable().optional(),
  stockRecipeVersion: z.number().int().positive().nullable().optional(),
});

export const saleCompletedLineSchema = z.object({
  billLineId: z.uuid(),
  catalogItemId: z.uuid(),
  quantity: z.number().int().positive(),
  stockRecipeId: z.uuid().nullable(),
  stockRecipeVersion: z.number().int().positive().nullable(),
  addons: z.array(saleCompletedAddonSchema).default([]),
});

export const saleCompletedPayloadSchema = z.object({
  billId: z.uuid(),
  outletId: z.uuid(),
  receiptNumber: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  committedAt: z.iso.datetime().optional(),
  finalTotal: z.string(),
  lines: z.array(saleCompletedLineSchema).min(1),
});

export type SaleCompletedPayload = z.infer<typeof saleCompletedPayloadSchema>;

export const saleRefundedLineSchema = z.object({
  billLineId: z.uuid(),
  catalogItemId: z.uuid().optional(),
  quantity: z.number().int().positive(),
  wastageClassification: z.literal('customer_cancelled').default('customer_cancelled'),
});

export const saleRefundedPayloadSchema = z.object({
  refundId: z.uuid(),
  billId: z.uuid(),
  kind: z.enum(['full', 'partial']),
  amount: z.string(),
  lines: z.array(saleRefundedLineSchema).min(1),
});

export type SaleRefundedPayload = z.infer<typeof saleRefundedPayloadSchema>;

/** Event types Stock emits back through its own outbox. */
export const STOCK_OUTBOUND_EVENT_TYPES = [
  'SaleConsumptionProcessed',
  'SaleConsumptionFailed',
  'RecipePublished',
  'ItemAvailabilityChanged',
  'OfflineAllowancePublished',
  'StockOrderPaid',
  'StockOrderDispatched',
  'RecallActivated',
] as const;

export type StockOutboundEventType = (typeof STOCK_OUTBOUND_EVENT_TYPES)[number];
