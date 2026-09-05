import { NextResponse } from 'next/server';
import { createBillCommandSchema } from '@jksh/contracts';
import { createBill, listBills } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const cmd = createBillCommandSchema.parse(await request.json());
    return NextResponse.json(await createBill(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const url = new URL(request.url);
    const businessDate = url.searchParams.get('businessDate');
    const cursor = url.searchParams.get('cursor');
    return NextResponse.json(
      await listBills(db(), actor, {
        outletId: actor.outletId,
        ...(businessDate ? { businessDate } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
