import { NextResponse } from 'next/server';
import { createPublicationCommandSchema } from '@jksh/contracts';
import { createAndApplyPublication } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createPublicationCommandSchema.parse(await request.json());
    return NextResponse.json(
      await createAndApplyPublication(db(), actor, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
