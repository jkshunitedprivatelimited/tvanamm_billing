import { NextResponse } from 'next/server';
import { getEmployeeActivitySummary } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request, { params }: { params: Promise<{ outletId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employeeId');
    const businessDate = url.searchParams.get('businessDate');
    if (!employeeId || !businessDate) {
      return NextResponse.json(
        { error: 'validation', message: 'employeeId and businessDate are required' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await getEmployeeActivitySummary(db(), actor, { outletId, employeeId, businessDate }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
