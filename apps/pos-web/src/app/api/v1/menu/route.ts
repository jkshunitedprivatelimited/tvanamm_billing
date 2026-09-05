import { NextResponse } from 'next/server';
import { getPublishedMenu } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function GET() {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const menu = await getPublishedMenu(db(), actor, actor.outletId);
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
