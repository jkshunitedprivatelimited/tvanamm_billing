import { NextResponse } from 'next/server';
import { createFranchiseCommandSchema } from '@jksh/contracts';
import { createFranchise, listFranchises } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function GET() {
  try {
    return NextResponse.json({ franchises: await listFranchises(db(), await actorOrThrow()) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createFranchiseCommandSchema.parse(await request.json());
    return NextResponse.json(await createFranchise(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
