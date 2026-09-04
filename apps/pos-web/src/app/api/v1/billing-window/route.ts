import { NextResponse } from 'next/server';
import { outletBillingWindow } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function GET() {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    return NextResponse.json(await outletBillingWindow(db(), actor, actor.outletId));
  } catch (error) {
    return jsonError(error);
  }
}
