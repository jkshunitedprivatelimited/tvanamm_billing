import { NextResponse } from 'next/server';
import { currentOperator } from '@/server/auth';
import { jsonError } from '@/server/http';

/** Older clients must use the combined expense review / handover / closing flow. */
export async function POST() {
  try {
    if (!(await currentOperator()))
      return NextResponse.json({ message: 'Please sign in again.' }, { status: 401 });
    return NextResponse.json(
      {
        message: 'Use Finish shift to review expenses and close or hand over the register.',
        next: '/close',
      },
      { status: 409 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
