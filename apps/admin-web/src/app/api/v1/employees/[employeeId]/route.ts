import { NextResponse } from 'next/server';
import { updateEmployeeCommandSchema } from '@jksh/contracts';
import { updateEmployee } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { employeeId } = await params;
    const cmd = updateEmployeeCommandSchema.parse(await request.json());
    await updateEmployee(db(), actor, employeeId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
