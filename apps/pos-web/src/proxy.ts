import { NextResponse, type NextRequest } from 'next/server';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Reject cross-site cookie-authenticated mutations before any route runs. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/') && MUTATING.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return NextResponse.json(
        { error: 'forbidden', message: 'Cross-site request rejected' },
        { status: 403 },
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
