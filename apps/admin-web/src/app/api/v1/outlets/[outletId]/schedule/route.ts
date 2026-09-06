import { NextResponse } from 'next/server';
import { setOutletScheduleCommandSchema } from '@jksh/contracts';
import { setOutletSchedule } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PUT(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const cmd = setOutletScheduleCommandSchema.parse(await request.json());
    await setOutletSchedule(db(), actor, outletId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
