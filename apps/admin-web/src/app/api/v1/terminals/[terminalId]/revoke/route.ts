import { NextResponse } from 'next/server';
import { revokeTerminalCommandSchema } from '@jksh/contracts';
import { revokeTerminal } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ terminalId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { terminalId } = await params;
    const { reason } = revokeTerminalCommandSchema.parse(await request.json());
    await revokeTerminal(db(), actor, terminalId, reason, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
