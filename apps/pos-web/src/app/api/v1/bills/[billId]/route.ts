import { NextResponse } from 'next/server';
import { getBill } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { billId } = await params;
    return NextResponse.json(await getBill(db(), actor, billId));
  } catch (error) {
    return jsonError(error);
  }
}
