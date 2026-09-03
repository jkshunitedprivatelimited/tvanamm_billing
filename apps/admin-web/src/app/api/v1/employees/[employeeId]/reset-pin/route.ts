import { NextResponse } from 'next/server';
import { resetPinCommandSchema } from '@jksh/contracts';
import { resetEmployeePin } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { employeeId } = await params;
    const { newPin } = resetPinCommandSchema.parse(await request.json());
    await resetEmployeePin(db(), actor, employeeId, newPin, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
