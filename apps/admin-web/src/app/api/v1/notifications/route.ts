import { NextResponse } from 'next/server';
import { listNotifications, markAllNotificationsRead } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const cursor = url.searchParams.get('cursor');
    return NextResponse.json(
      await listNotifications(db(), actor, {
        ...(unreadOnly ? { unreadOnly } : {}),
        ...(cursor ? { cursor } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action === 'read-all') {
      await markAllNotificationsRead(db(), actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'validation', message: 'unknown action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
