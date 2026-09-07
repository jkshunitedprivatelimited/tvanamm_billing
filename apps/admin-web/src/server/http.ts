import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IdentityError } from '@jksh/identity';
import { StockError } from '@jksh/stock';
import type { ActorContext } from '@jksh/contracts';
import { getAdminActor } from './auth';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' };

/** JSON response that is never cached and carries the correlation id. */
export function apiJson(body: unknown, init: { status?: number; correlationId?: string } = {}) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (init.correlationId) headers['x-correlation-id'] = init.correlationId;
  return NextResponse.json(body, { status: init.status ?? 200, headers });
}

export function jsonError(error: unknown, correlationId?: string): NextResponse {
  if (error instanceof z.ZodError) {
    return apiJson(
      {
        error: 'validation',
        message: 'Invalid request',
        issues: error.issues.map((i) => i.path.join('.')),
      },
      { status: 400, ...(correlationId ? { correlationId } : {}) },
    );
  }
  if (error instanceof IdentityError || error instanceof StockError) {
    return apiJson(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status: error.httpStatus, ...(correlationId ? { correlationId } : {}) },
    );
  }
  // Log the error only — never the request body, cookies, or credentials.
  console.error('[admin-web] route error', error instanceof Error ? error.message : 'unknown');
  return apiJson(
    { error: 'internal', message: 'Unexpected error' },
    { status: 500, ...(correlationId ? { correlationId } : {}) },
  );
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Reject a cross-site cookie-authenticated mutation before any domain code runs. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // same-origin navigations / server-to-server send none
  if (!ALLOWED_ORIGINS.includes(origin)) {
    throw new IdentityError('forbidden', 'Cross-site request rejected', { httpStatus: 403 });
  }
}

export function requestMeta(request: Request): {
  correlationId: string;
  userAgent?: string;
  ip?: string;
} {
  // x-forwarded-for is only trusted when the deployment proxy overwrites it.
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const ip = trustProxy
    ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      '')
    : '';
  const userAgent = request.headers.get('user-agent') ?? '';
  return {
    correlationId: request.headers.get('x-correlation-id') ?? crypto.randomUUID(),
    ...(userAgent ? { userAgent } : {}),
    ...(ip ? { ip } : {}),
  };
}

/** Resolve the admin actor for a Route Handler or throw a typed 401/403. */
export async function actorOrThrow(): Promise<ActorContext> {
  const { user, actor } = await getAdminActor();
  if (!user) throw new IdentityError('unauthenticated', 'Sign in required');
  if (!actor) throw new IdentityError('forbidden', 'Select a workspace first');
  return actor;
}
