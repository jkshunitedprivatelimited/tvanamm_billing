import { NextResponse } from 'next/server';
import { setEmployeeStatusCommandSchema } from '@jksh/contracts';
import { setEmployeeStatus } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { employeeId } = await params;
    const cmd = setEmployeeStatusCommandSchema.parse(await request.json());
    await setEmployeeStatus(db(), actor, employeeId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
