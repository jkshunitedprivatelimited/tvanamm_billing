import { z } from 'zod';

export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(1),
  eventVersion: z.int().positive(),
  occurredAt: z.iso.datetime(),
  source: z.string().min(1),
  correlationId: z.uuid(),
  idempotencyKey: z.string().min(1).max(200),
  organizationId: z.uuid(),
  franchiseId: z.uuid(),
  outletId: z.uuid(),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

