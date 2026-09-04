import { NextResponse } from 'next/server';
import { createAddonGroupCommandSchema } from '@jksh/contracts';
import { createAddonGroup } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createAddonGroupCommandSchema.parse(await request.json());
    return NextResponse.json(await createAddonGroup(db(), actor, cmd));
  } catch (error) {
    return jsonError(error);
  }
}
