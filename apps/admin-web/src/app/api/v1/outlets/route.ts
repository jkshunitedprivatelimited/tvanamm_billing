import { NextResponse } from 'next/server';
import { createOutletCommandSchema } from '@jksh/contracts';
import { createOutlet, listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function GET() {
  try {
    return NextResponse.json({ outlets: await listOutlets(db(), await actorOrThrow()) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createOutletCommandSchema.parse(await request.json());
    return NextResponse.json(await createOutlet(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
