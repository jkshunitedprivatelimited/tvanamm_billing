import { NextResponse } from 'next/server';
import { listAttendance } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const url = new URL(request.url);
    const businessDate = url.searchParams.get('businessDate');
    const employeeId = url.searchParams.get('employeeId');
    return NextResponse.json({
      sessions: await listAttendance(db(), actor, {
        outletId,
        ...(businessDate ? { businessDate } : {}),
        ...(employeeId ? { employeeId } : {}),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
