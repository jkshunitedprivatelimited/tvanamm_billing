import { NextResponse } from 'next/server';
import { listAuditEvents } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const u = new URL(request.url);
    const action = u.searchParams.get('action') ?? undefined;
    const outletId = u.searchParams.get('outletId') ?? undefined;
    const from = u.searchParams.get('from') ?? undefined;
    const to = u.searchParams.get('to') ?? undefined;
    const cursor = u.searchParams.get('cursor') ?? undefined;
    const limitRaw = u.searchParams.get('limit');

    return NextResponse.json(
      await listAuditEvents(db(), actor, {
        ...(action ? { action } : {}),
        ...(outletId ? { outletId } : {}),
        ...(from && DATE.test(from) ? { from } : {}),
        ...(to && DATE.test(to) ? { to } : {}),
        ...(cursor ? { cursor } : {}),
        ...(limitRaw ? { limit: Number(limitRaw) } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
