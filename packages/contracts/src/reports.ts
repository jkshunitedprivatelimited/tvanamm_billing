import { z } from 'zod';
import { moneySchema } from './billing';

export const reportRangeKindSchema = z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']);

export const reportRangeSchema = z
  .object({
    kind: reportRangeKindSchema,
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((v) => v.kind !== 'custom' || (!!v.from && !!v.to), {
    message: 'A custom range needs both from and to dates',
  });
export type ReportRangeInput = z.infer<typeof reportRangeSchema>;

export const financialSummarySchema = z.object({
  outletId: z.uuid().nullable(),
  outletName: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  grossSales: moneySchema,
  discountTotal: moneySchema,
  refundTotal: moneySchema,
  netSales: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  cashTotal: moneySchema,
  upiTotal: moneySchema,
  complimentaryCount: z.int(),
  billCount: z.int(),
});

export const financialReportResponseSchema = z.object({
  combined: financialSummarySchema,
  byOutlet: z.array(financialSummarySchema),
});
export type FinancialReportResponse = z.infer<typeof financialReportResponseSchema>;
