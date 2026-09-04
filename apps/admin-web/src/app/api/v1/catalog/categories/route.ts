import { NextResponse } from 'next/server';
import { createCategoryCommandSchema } from '@jksh/contracts';
import { createCategory } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createCategoryCommandSchema.parse(await request.json());
    return NextResponse.json(await createCategory(db(), actor, cmd));
  } catch (error) {
    return jsonError(error);
  }
}
