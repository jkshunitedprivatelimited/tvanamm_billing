import { getReceiptSettings, updateReceiptSettings } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError, requestMeta } from '@/server/http';

export async function GET(_request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    const { outletId } = await ctx.params;
    return apiJson(await getReceiptSettings(db(), await actorOrThrow(), outletId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    return apiJson(
      await updateReceiptSettings(
        db(),
        await actorOrThrow(),
        outletId,
        await request.json(),
        requestMeta(request),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
