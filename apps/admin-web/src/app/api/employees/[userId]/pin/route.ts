import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetEmployeePin } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { requireActorRoute } from '@/server/auth';

const bodySchema = z.object({ newPin: z.string().regex(/^\d{4}$/) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireActorRoute();
    const { userId } = await params;
    const { newPin } = bodySchema.parse(await request.json());
    await resetEmployeePin(db(), actor, { userId, newPin }, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
