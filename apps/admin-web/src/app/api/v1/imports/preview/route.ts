import { NextResponse } from 'next/server';
import { previewImportCommandSchema } from '@jksh/contracts';
import { previewImport } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = previewImportCommandSchema.parse(await request.json());
    return NextResponse.json(await previewImport(db(), actor, cmd));
  } catch (error) {
    return jsonError(error);
  }
}
