import { NextResponse } from 'next/server';
import { setExpenseThresholdCommandSchema } from '@jksh/contracts';
import { setExpenseThreshold } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PUT(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = setExpenseThresholdCommandSchema.parse(await request.json());
    await setExpenseThreshold(db(), actor, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
