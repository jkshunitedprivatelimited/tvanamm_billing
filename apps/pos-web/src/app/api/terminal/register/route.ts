import { NextResponse } from 'next/server';
import { registerTerminalCommandSchema } from '@jksh/contracts';
import { registerTerminal } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const cmd = registerTerminalCommandSchema.parse(await request.json());
    const result = await registerTerminal(db(), cmd, requestMeta(request));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
