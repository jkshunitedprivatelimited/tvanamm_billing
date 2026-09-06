import { NextResponse } from 'next/server';
import { getExpenseReport } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json(
        { error: 'validation', message: 'from and to are required' },
        { status: 400 },
      );
    }
    return NextResponse.json(await getExpenseReport(db(), actor, { outletId, from, to }));
  } catch (error) {
    return jsonError(error);
  }
}
