import { NextResponse } from 'next/server';
import { getExpenseThreshold } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    return NextResponse.json(await getExpenseThreshold(db(), actor, outletId));
  } catch (error) {
    return jsonError(error);
  }
}
