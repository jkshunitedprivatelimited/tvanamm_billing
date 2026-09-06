import { NextResponse } from 'next/server';
import { listExpenses } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const url = new URL(request.url);
    const businessDate = url.searchParams.get('businessDate');
    const unreviewedOnly = url.searchParams.get('unreviewedOnly') === 'true';
    return NextResponse.json({
      expenses: await listExpenses(db(), actor, {
        outletId,
        ...(businessDate ? { businessDate } : {}),
        ...(unreviewedOnly ? { unreviewedOnly } : {}),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
