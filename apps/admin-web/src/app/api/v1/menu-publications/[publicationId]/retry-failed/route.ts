import { NextResponse } from 'next/server';
import { retryFailedTargets } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { publicationId } = await params;
    return NextResponse.json(
      await retryFailedTargets(db(), actor, publicationId, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
