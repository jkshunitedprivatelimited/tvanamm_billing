import { NextResponse } from 'next/server';
import { withTransaction } from '@jksh/db';
import { recordAudit, revokeSession, IdentityError } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { requireActorRoute } from '@/server/auth';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await requireActorRoute();
    const { sessionId } = await params;
    const meta = requestMeta(request);
    await withTransaction(db(), async (client) => {
      const { rows } = await client.query<{ user_id: string }>(
        `select user_id from identity.sessions where id = $1`,
        [sessionId],
      );
      if (rows[0]?.user_id !== actor.userId) {
        throw new IdentityError('forbidden', 'Not your session');
      }
      await revokeSession(client, sessionId, 'user_revoked_device');
      await recordAudit(client, {
        action: 'session.revoked',
        result: 'success',
        actorUserId: actor.userId,
        sessionId,
        correlationId: meta.correlationId,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
