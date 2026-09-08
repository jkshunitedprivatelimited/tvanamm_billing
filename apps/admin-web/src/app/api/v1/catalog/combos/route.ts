import { NextResponse } from 'next/server';
import { createComboCommandSchema } from '@jksh/contracts';
import { createCombo } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createComboCommandSchema.parse(await request.json());
    return NextResponse.json(await createCombo(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
