import { NextResponse } from 'next/server';
import { confirmImportCommandSchema } from '@jksh/contracts';
import { confirmImport } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = confirmImportCommandSchema.parse(await request.json());
    return NextResponse.json(await confirmImport(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
