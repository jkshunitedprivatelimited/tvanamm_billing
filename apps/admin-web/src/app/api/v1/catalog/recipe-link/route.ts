import { NextResponse } from 'next/server';
import { z } from 'zod';
import { linkStockRecipe } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, assertSameOrigin, jsonError, requestMeta } from '@/server/http';

const bodySchema = z
  .object({
    target: z.enum(['item', 'addon']),
    targetId: z.uuid(),
    stockRecipeId: z.uuid().nullable(),
    stockRecipeVersion: z.number().int().positive().nullable(),
  })
  .refine((v) => (v.stockRecipeId === null) === (v.stockRecipeVersion === null), {
    message: 'stockRecipeId and stockRecipeVersion must be set together',
  });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const cmd = bodySchema.parse(await request.json());
    return NextResponse.json(await linkStockRecipe(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
