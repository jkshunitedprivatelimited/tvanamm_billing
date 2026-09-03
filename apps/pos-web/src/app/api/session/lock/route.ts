import { NextResponse } from 'next/server';
import { lockWorkstation } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentSessionId } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const sessionId = await currentSessionId();
    if (sessionId) await lockWorkstation(db(), sessionId, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
