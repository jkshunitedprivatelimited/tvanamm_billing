import { NextResponse } from 'next/server';
import { getPublication } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { publicationId } = await params;
    return NextResponse.json(await getPublication(db(), actor, publicationId));
  } catch (error) {
    return jsonError(error);
  }
}
