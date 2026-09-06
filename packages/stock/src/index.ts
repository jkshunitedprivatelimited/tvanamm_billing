export { StockError, type StockErrorCode } from './errors';
export {
  ensureStockAllowed,
  stockActorHas,
  stockCapabilities,
  stockContextForActor,
  stockSystemActor,
  type StockActor,
} from './authorize';
export { recordStockAudit, stockAuditOutOfBand, type StockAuditInput } from './audit';
export {
  canonicalJson,
  signEventPayload,
  verifyEventSignature,
  ingestInboundEvent,
  recordStockOutbox,
  type IngestResult,
  type StockOutboxInput,
} from './events';
export {
  resolveStockActor,
  upsertIdentityProjection,
  type VerifiedIdentity,
  type UpsertProjectionCommand,
} from './identity-projection';
