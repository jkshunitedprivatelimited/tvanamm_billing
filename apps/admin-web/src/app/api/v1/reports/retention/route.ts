import { NextResponse } from 'next/server';
import { getRetentionStatus } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const url = new URL(request.url);
    const franchiseId = url.searchParams.get('franchiseId') ?? undefined;
    const outletId = url.searchParams.get('outletId') ?? undefined;
    return NextResponse.json(
      await getRetentionStatus(db(), actor, {
        ...(franchiseId ? { franchiseId } : {}),
        ...(outletId ? { outletId } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
