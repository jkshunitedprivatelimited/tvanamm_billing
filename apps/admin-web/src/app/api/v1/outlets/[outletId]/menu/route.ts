import { NextResponse } from 'next/server';
import { getPublishedMenu } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const version = new URL(request.url).searchParams.get('version') ?? undefined;
    const menu = await getPublishedMenu(db(), actor, outletId, version);
    if (!menu)
      return NextResponse.json(
        { error: 'not_found', message: 'No published menu' },
        { status: 404 },
      );
    return NextResponse.json(menu);
  } catch (error) {
    return jsonError(error);
  }
}
