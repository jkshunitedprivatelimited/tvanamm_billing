import { NextResponse } from 'next/server';
import { listBills } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const url = new URL(request.url);
    const businessDate = url.searchParams.get('businessDate');
    const cursor = url.searchParams.get('cursor');
    return NextResponse.json(
      await listBills(db(), actor, {
        outletId,
        ...(businessDate ? { businessDate } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
