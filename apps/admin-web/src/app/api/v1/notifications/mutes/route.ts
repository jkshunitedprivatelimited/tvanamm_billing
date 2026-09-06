import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setNotificationMute } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

const schema = z.object({ category: z.string().trim().min(1).max(60), muted: z.boolean() });

export async function PUT(request: Request) {
  try {
    const actor = await actorOrThrow();
    const { category, muted } = schema.parse(await request.json());
    await setNotificationMute(db(), actor, category, muted);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
