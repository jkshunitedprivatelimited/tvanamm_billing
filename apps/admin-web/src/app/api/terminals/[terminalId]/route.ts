import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeTerminal } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { requireActorRoute } from '@/server/auth';

const bodySchema = z.object({ reason: z.string().trim().min(1).max(300) });

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ terminalId: string }> },
) {
  try {
    const actor = await requireActorRoute();
    const { terminalId } = await params;
    const { reason } = bodySchema.parse(await request.json().catch(() => ({ reason: 'revoked by admin' })));
    await revokeTerminal(db(), actor, terminalId, reason, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
