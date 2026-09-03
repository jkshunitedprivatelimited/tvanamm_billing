import { NextResponse } from 'next/server';
import { createEmployeeCommandSchema } from '@jksh/contracts';
import { createEmployee, listEmployees } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    return NextResponse.json({ employees: await listEmployees(db(), actor, outletId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const raw: unknown = await request.json().catch(() => ({}));
    const cmd = createEmployeeCommandSchema.parse({ ...(raw as object), outletId });
    return NextResponse.json(await createEmployee(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
