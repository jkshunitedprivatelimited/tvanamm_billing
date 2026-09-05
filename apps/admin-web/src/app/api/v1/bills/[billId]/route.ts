import { NextResponse } from 'next/server';
import { getBill } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { billId } = await params;
    return NextResponse.json(await getBill(db(), actor, billId));
  } catch (error) {
    return jsonError(error);
  }
}
