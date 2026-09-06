import { randomUUID } from 'node:crypto';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';

type Ref = string | null | undefined;

export interface StockAuditInput {
  action: string;
  actorRequest: 'system' | 'admin' | 'operator';
  accountId?: Ref;
  employeeId?: Ref;
  organizationId?: Ref;
  franchiseId?: Ref;
  outletId?: Ref;
  warehouseId?: Ref;
  subjectType?: Ref;
  subjectId?: Ref;
  requestId?: Ref;
  data?: Record<string, unknown>;
}

/** Append a Stock audit event inside the same transaction as its action. */
export async function recordStockAudit(
  client: StockPoolClient,
  input: StockAuditInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into stock_audit.events
       (id, actor_request, account_id, employee_id, organization_id, franchise_id,
        outlet_id, warehouse_id, action, subject_type, subject_id, request_id, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      input.actorRequest,
      input.accountId ?? null,
      input.employeeId ?? null,
      input.organizationId ?? null,
      input.franchiseId ?? null,
      input.outletId ?? null,
      input.warehouseId ?? null,
      input.action,
      input.subjectType ?? null,
      input.subjectId ?? null,
      input.requestId ?? null,
      JSON.stringify(input.data ?? {}),
    ],
  );
  return id;
}

/** Record a denied/failed sensitive command in its own transaction. */
export async function stockAuditOutOfBand(pool: StockPool, input: StockAuditInput): Promise<void> {
  await withStockActorContext(pool, stockSystemContext(), (client) =>
    recordStockAudit(client, input),
  );
}
