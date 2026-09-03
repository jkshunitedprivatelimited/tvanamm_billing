import { NextResponse } from 'next/server';
import { lockOperator } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { operatorToken } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const token = await operatorToken();
    if (token) await lockOperator(db(), token, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
