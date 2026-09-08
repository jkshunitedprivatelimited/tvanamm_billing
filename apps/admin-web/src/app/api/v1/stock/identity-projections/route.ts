import { z } from 'zod';
import { upsertIdentityProjection } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z
  .object({
    accountId: z.uuid().optional(),
    employeeId: z.uuid().optional(),
    role: z.enum([
      'central_admin',
      'accountant',
      'franchise_owner',
      'warehouse_manager',
      'warehouse_staff',
      'store_employee',
    ]),
    franchiseId: z.uuid().optional(),
    displayName: z.string().max(160).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => (v.accountId ? 1 : 0) + (v.employeeId ? 1 : 0) === 1, {
    message: 'Exactly one of accountId / employeeId is required',
  });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await upsertIdentityProjection(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
