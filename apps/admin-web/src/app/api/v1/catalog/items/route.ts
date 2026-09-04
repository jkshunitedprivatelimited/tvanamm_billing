import { NextResponse } from 'next/server';
import { createCatalogItemCommandSchema } from '@jksh/contracts';
import { createCatalogItem } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createCatalogItemCommandSchema.parse(await request.json());
    return NextResponse.json(await createCatalogItem(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
