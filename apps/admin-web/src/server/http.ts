import 'server-only';
import { NextResponse } from 'next/server';
import { IdentityError } from '@jksh/identity';

export function jsonError(error: unknown): NextResponse {
  if (error instanceof IdentityError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status: error.httpStatus },
    );
  }
  console.error('[admin-web] unhandled route error', error);
  return NextResponse.json({ error: 'internal', message: 'Unexpected error' }, { status: 500 });
}

export function requestMeta(request: Request): {
  correlationId: string;
  userAgent?: string;
  ip?: string;
} {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '';
  const userAgent = request.headers.get('user-agent') ?? '';
  return {
    correlationId: crypto.randomUUID(),
    ...(userAgent ? { userAgent } : {}),
    ...(ip ? { ip } : {}),
  };
}
