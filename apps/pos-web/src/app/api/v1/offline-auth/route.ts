import { NextResponse } from 'next/server';
import { issueOfflineAuth } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    return NextResponse.json(await issueOfflineAuth(db(), actor, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
