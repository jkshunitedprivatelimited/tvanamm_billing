import { NextResponse } from 'next/server';
import { selectWorkspaceCommandSchema } from '@jksh/contracts';
import { listWorkspaceCards, selectWorkspace, IdentityError } from '@jksh/identity';
import { db } from '@/server/pool';
import { getAuthUser } from '@/server/auth';
import { jsonError, requestMeta } from '@/server/http';
import { WS_COOKIE, signWorkspace, wsCookieOptions } from '@/server/ws-cookie';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) throw new IdentityError('unauthenticated', 'Sign in first');
    return NextResponse.json({ workspaces: await listWorkspaceCards(db(), user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) throw new IdentityError('unauthenticated', 'Sign in first');
    const { membershipId } = selectWorkspaceCommandSchema.parse(await request.json());
    const result = await selectWorkspace(
      db(),
      { authUserId: user.id, membershipId },
      requestMeta(request),
    );
    const response = NextResponse.json(result);
    response.cookies.set(WS_COOKIE, signWorkspace(membershipId), wsCookieOptions);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
