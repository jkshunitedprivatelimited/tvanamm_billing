import { NextResponse } from 'next/server';
import { withTransaction } from '@jksh/db';
import { listUserSessions } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';
import { requireActorRoute } from '@/server/auth';
import { readSession } from '@/server/auth';

export async function GET() {
  try {
    const actor = await requireActorRoute();
    const state = await readSession();
    const sessions = await withTransaction(db(), (client) =>
      listUserSessions(client, actor.userId, state?.sessionId ?? ''),
    );
    return NextResponse.json({ sessions });
  } catch (error) {
    return jsonError(error);
  }
}
