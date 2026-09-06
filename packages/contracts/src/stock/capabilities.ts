/**
 * Stock authorization policy. Mirrors `stock.capabilities` /
 * `stock.role_capabilities` in the Stock database (an integration test asserts
 * equality). Scope (organization / franchise / outlet / warehouse) still
 * decides *which* resources a capability reaches.
 */

export const STOCK_CAPABILITIES = [
  'stock.config.manage',
  'stock.master.manage',
  'stock.recipe.manage',
  'stock.recipe.read',
  'stock.supplier.manage',
  'stock.receiving.operate',
  'stock.production.operate',
  'stock.dispatch.operate',
  'stock.count.operate',
  'stock.wastage.operate',
  'stock.transfer.operate',
  'stock.adjustment.approve',
  'stock.supplier_payment.record',
  'stock.order.create',
  'stock.order.oversee',
  'stock.inward.operate',
  'stock.local_inward.record',
  'stock.local_inward.review',
  'stock.return.request',
  'stock.return.approve',
  'stock.recall.manage',
  'stock.report.read',
  'stock.inventory.read',
] as const;

export type StockCapability = (typeof STOCK_CAPABILITIES)[number];

export const STOCK_ACTOR_ROLES = [
  'central_admin',
  'accountant',
  'franchise_owner',
  'warehouse_manager',
  'warehouse_staff',
  'store_employee',
] as const;

export type StockActorRole = (typeof STOCK_ACTOR_ROLES)[number];

const ACCOUNTANT: readonly StockCapability[] = [
  'stock.supplier_payment.record',
  'stock.report.read',
  'stock.inventory.read',
  'stock.recipe.read',
];

const WAREHOUSE_MANAGER: readonly StockCapability[] = [
  'stock.supplier.manage',
  'stock.receiving.operate',
  'stock.production.operate',
  'stock.dispatch.operate',
  'stock.count.operate',
  'stock.wastage.operate',
  'stock.transfer.operate',
  'stock.adjustment.approve',
  'stock.order.oversee',
  'stock.return.approve',
  'stock.recall.manage',
  'stock.report.read',
  'stock.inventory.read',
  'stock.recipe.read',
];

const WAREHOUSE_STAFF: readonly StockCapability[] = [
  'stock.receiving.operate',
  'stock.production.operate',
  'stock.dispatch.operate',
  'stock.count.operate',
  'stock.wastage.operate',
  'stock.transfer.operate',
  'stock.inventory.read',
  'stock.recipe.read',
];

const FRANCHISE_OWNER: readonly StockCapability[] = [
  'stock.order.create',
  'stock.order.oversee',
  'stock.inward.operate',
  'stock.local_inward.record',
  'stock.local_inward.review',
  'stock.return.request',
  'stock.return.approve',
  'stock.count.operate',
  'stock.wastage.operate',
  'stock.report.read',
  'stock.inventory.read',
  'stock.recipe.read',
];

const STORE_EMPLOYEE: readonly StockCapability[] = [
  'stock.inward.operate',
  'stock.local_inward.record',
  'stock.return.request',
  'stock.count.operate',
  'stock.wastage.operate',
  'stock.inventory.read',
  'stock.recipe.read',
];

export const STOCK_ROLE_CAPABILITIES: Readonly<Record<StockActorRole, readonly StockCapability[]>> =
  {
    central_admin: STOCK_CAPABILITIES,
    accountant: ACCOUNTANT,
    warehouse_manager: WAREHOUSE_MANAGER,
    warehouse_staff: WAREHOUSE_STAFF,
    franchise_owner: FRANCHISE_OWNER,
    store_employee: STORE_EMPLOYEE,
  };

export function stockRoleGrants(role: StockActorRole, capability: StockCapability): boolean {
  return STOCK_ROLE_CAPABILITIES[role].includes(capability);
}
