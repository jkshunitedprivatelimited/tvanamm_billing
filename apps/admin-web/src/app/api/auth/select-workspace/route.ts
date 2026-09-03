import { NextResponse } from 'next/server';
import { selectWorkspaceCommandSchema } from '@jksh/contracts';
import { selectWorkspace, IdentityError } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { readSession } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const session = await readSession();
    if (!session) throw new IdentityError('unauthenticated', 'Sign in first');
    const { membershipId } = selectWorkspaceCommandSchema.parse(await request.json());
    const result = await selectWorkspace(db(), session.sessionId, membershipId, requestMeta(request));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
