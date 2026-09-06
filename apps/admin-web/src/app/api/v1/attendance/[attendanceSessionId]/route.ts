import { NextResponse } from 'next/server';
import { correctAttendanceCommandSchema } from '@jksh/contracts';
import { correctAttendance } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ attendanceSessionId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { attendanceSessionId } = await params;
    const cmd = correctAttendanceCommandSchema.parse(await request.json());
    await correctAttendance(db(), actor, attendanceSessionId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
