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
export { toBaseQuantity } from './units';
export { applyInbound, applyOutbound, positionValuePaise, type AvgState } from './valuation';
export {
  orderFefo,
  allocateFefo,
  type BatchPosition,
  type Allocation,
  type FefoResult,
} from './fefo';
export {
  postMovement,
  postMovements,
  pickFefo,
  rebuildProjections,
  type MovementInput,
  type MovementResult,
  type FefoPick,
} from './ledger';
export {
  createItem,
  setItemUnitConversion,
  addItemBarcode,
  createWarehouse,
  configureOutletStock,
  createBatch,
  listItems,
  getItemBalances,
  type CreateItemCommand,
  type CreateWarehouseCommand,
  type ConfigureOutletStockCommand,
  type CreateBatchCommand,
  type ItemRow,
  type BalanceRow,
} from './inventory';
