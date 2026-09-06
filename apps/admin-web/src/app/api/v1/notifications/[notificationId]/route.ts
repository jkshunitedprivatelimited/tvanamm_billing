import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markNotification } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

const schema = z.object({ what: z.enum(['read', 'resolved']) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { notificationId } = await params;
    const { what } = schema.parse(await request.json());
    await markNotification(db(), actor, notificationId, what);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
