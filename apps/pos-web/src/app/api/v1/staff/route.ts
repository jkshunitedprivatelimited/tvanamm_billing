import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listOutletStaff, recordStaffAttendance } from '@jksh/identity';
import { currentOperator, registeredTerminalCredential } from '@/server/auth';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';

export async function GET() {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });
    return NextResponse.json({ staff: await listOutletStaff(db(), actor) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    const terminalCredential = await registeredTerminalCredential();
    if (!actor || !terminalCredential)
      return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });
    const cmd = z
      .object({
        employeeId: z.string().uuid(),
        pin: z.string().regex(/^\d{4}$/),
        action: z.enum(['check-in', 'check-out']),
      })
      .parse(await request.json());
    await recordStaffAttendance(db(), actor, { ...cmd, terminalCredential }, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
