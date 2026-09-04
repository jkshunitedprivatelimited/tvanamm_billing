import { NextResponse } from 'next/server';
import { previewPublicationCommandSchema } from '@jksh/contracts';
import { previewPublication } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = previewPublicationCommandSchema.parse(await request.json());
    return NextResponse.json(await previewPublication(db(), actor, cmd));
  } catch (error) {
    return jsonError(error);
  }
}
