import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { StockPoolClient } from '@jksh/db';
import {
  stockInboundEnvelopeSchema,
  type StockInboundEnvelope,
  type StockOutboundEventType,
} from '@jksh/contracts';
import { StockError } from './errors';

/** Deterministic JSON: object keys sorted recursively so a signature is stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}

function eventSecret(): string | undefined {
  const value = process.env.STOCK_EVENT_SECRET;
  return value && value.length > 0 ? value : undefined;
}

/** HMAC-SHA256 of the canonical payload, hex. */
export function signEventPayload(payload: unknown, secret = eventSecret()): string | undefined {
  if (!secret) return undefined;
  return createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex');
}

/**
 * Constant-time signature check. Returns whether the signature is present and
 * verified. When no secret is configured (local/dev) an unsigned event is
 * accepted with `verified: false` so integration tests can run without keys;
 * a configured secret makes a missing/invalid signature a hard failure.
 */
export function verifyEventSignature(
  payload: unknown,
  signature: string | undefined,
): { verified: boolean } {
  const secret = eventSecret();
  if (!secret) return { verified: false };
  if (!signature) {
    throw new StockError('signature_invalid', 'Event signature is required');
  }
  const expected = createHmac('sha256', secret).update(canonicalJson(payload)).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    throw new StockError('signature_invalid', 'Event signature is malformed');
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new StockError('signature_invalid', 'Event signature does not match');
  }
  return { verified: true };
}

export interface IngestResult {
  inboxId: string;
  duplicate: boolean;
  signatureVerified: boolean;
}

/**
 * Land a Billing event in `stock_inbox.events` exactly once, keyed by
 * `(source, source_event_id)`. Re-delivering the same event is a no-op and
 * returns the existing row (`billing-stock-recipe-contract.md` "Failure
 * Handling"). Processing happens separately from ingestion.
 */
export async function ingestInboundEvent(
  client: StockPoolClient,
  raw: unknown,
): Promise<IngestResult> {
  const parsed = stockInboundEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StockError('validation', 'Malformed inbound event', {
      details: { issues: parsed.error.issues },
    });
  }
  const env: StockInboundEnvelope = parsed.data;
  const { verified } = verifyEventSignature(env.payload, env.signature);

  const existing = await client.query<{ id: string; signature_verified: boolean }>(
    `select id, signature_verified from stock_inbox.events
      where source = $1 and source_event_id = $2`,
    [env.source, env.eventId],
  );
  const dup = existing.rows[0];
  if (dup) {
    return { inboxId: dup.id, duplicate: true, signatureVerified: dup.signature_verified };
  }

  const id = randomUUID();
  await client.query(
    `insert into stock_inbox.events
       (id, source, source_event_id, event_type, event_version, payload, signature,
        signature_verified, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      env.source,
      env.eventId,
      env.eventType,
      env.eventVersion,
      JSON.stringify(env.payload),
      env.signature ?? null,
      verified,
      env.correlationId,
    ],
  );
  return { inboxId: id, duplicate: false, signatureVerified: verified };
}

export interface StockOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: StockOutboundEventType;
  eventVersion?: number;
  correlationId?: string;
  payload: Record<string, unknown>;
}

/** Enqueue a Stock domain event in the same transaction as the write. */
export async function recordStockOutbox(
  client: StockPoolClient,
  input: StockOutboxInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into stock_outbox.events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, signature,
        correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.eventVersion ?? 1,
      JSON.stringify(input.payload),
      signEventPayload(input.payload) ?? null,
      input.correlationId ?? randomUUID(),
    ],
  );
  return id;
}
