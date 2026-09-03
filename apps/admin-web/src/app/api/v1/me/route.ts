import { NextResponse } from 'next/server';
import { grantedCapabilities } from '@jksh/identity';
import { getAdminActor } from '@/server/auth';
import { jsonError } from '@/server/http';

export async function GET() {
  try {
    const { user, actor } = await getAdminActor();
    if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
    return NextResponse.json({
      authenticated: true,
      needsWorkspace: !actor,
      actor: actor
        ? {
            role: actor.role,
            scope: actor.scope,
            capabilities: grantedCapabilities(actor),
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
