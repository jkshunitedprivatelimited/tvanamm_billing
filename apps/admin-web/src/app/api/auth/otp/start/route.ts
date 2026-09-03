import { NextResponse } from 'next/server';
import { startOtpCommandSchema } from '@jksh/contracts';
import { startAdminOtp } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const cmd = startOtpCommandSchema.parse(body);
    const result = await startAdminOtp(db(), cmd, requestMeta(request));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
