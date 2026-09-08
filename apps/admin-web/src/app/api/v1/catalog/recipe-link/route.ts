import { NextResponse } from 'next/server';
import { z } from 'zod';
import { linkStockRecipe } from '@jksh/identity';
import { assertRecipePublished } from '@jksh/stock';
import { db } from '@/server/pool';
import { actorOrThrow, assertSameOrigin, jsonError, requestMeta } from '@/server/http';
import { stockDb } from '@/server/stock';

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

    // Validate against the Stock database before Billing records the link.
    if (cmd.stockRecipeId && cmd.stockRecipeVersion) {
      const recipe = await assertRecipePublished(
        stockDb(),
        cmd.stockRecipeId,
        cmd.stockRecipeVersion,
      );
      const wantKind = cmd.target === 'item' ? 'menu_item' : 'addon';
      if (recipe.kind !== wantKind) {
        return NextResponse.json(
          { error: 'validation', message: `Recipe is a ${recipe.kind}, not a ${wantKind} recipe` },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(await linkStockRecipe(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
