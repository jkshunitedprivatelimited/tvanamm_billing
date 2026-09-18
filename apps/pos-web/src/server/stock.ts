import 'server-only';
import { stockPgPool } from '@jksh/db';
import { resolveStockActor, isStockFeatureEnabled, StockError } from '@jksh/stock';
import type { ActorContext } from '@jksh/contracts';
export function stockDb() {
  return stockPgPool(process.env.STOCK_DATABASE_URL);
}
export async function operatorStockActor(actor: ActorContext) {
  if (actor.kind !== 'operator' || !actor.employeeId || !actor.outletId)
    throw new StockError('forbidden', 'Please sign in at your outlet');
  if (!(await isStockFeatureEnabled(stockDb(), 'stock.enabled')))
    throw new StockError('forbidden', 'Stock entry is not available yet');
  return resolveStockActor(stockDb(), {
    request: 'operator',
    billingRole: 'store_employee',
    organizationId: actor.scope.organizationId,
    employeeId: actor.employeeId,
    outletId: actor.outletId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
}
