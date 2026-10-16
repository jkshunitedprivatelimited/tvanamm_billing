import { NextResponse } from 'next/server';
import { getPosRecipeHelp } from '@jksh/identity';
import { currentOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';

export async function GET(_request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { itemId } = await context.params;
    const help = await getPosRecipeHelp(db(), actor, itemId);
    return NextResponse.json(help, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
