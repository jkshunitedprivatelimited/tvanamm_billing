import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { localSessionAuthEnabled } from '@/dev-auth-flags';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isProd = process.env.NODE_ENV === 'production';

/** Per-request nonce-based CSP so Next.js's inline bootstrap scripts are allowed
 *  without `'unsafe-inline'` in production. */
function contentSecurityPolicy(nonce: string): string {
  // Razorpay Checkout (Franchise Owner stock-order prepayment only) loads its
  // own script, renders payment methods in an iframe from api.razorpay.com,
  // and calls out to its own analytics/status endpoints.
  const razorpayScript = 'https://checkout.razorpay.com';
  const razorpayFrame = 'https://api.razorpay.com https://checkout.razorpay.com';
  const razorpayConnect = 'https://api.razorpay.com https://lumberjack.razorpay.com';
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${razorpayScript}`
    : `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${razorpayScript}`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.razorpay.com",
    "font-src 'self'",
    `connect-src 'self' https://*.supabase.co ${razorpayConnect}`,
    `frame-src ${razorpayFrame}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  // Reject cross-site cookie-authenticated mutations before any route runs.
  if (request.nextUrl.pathname.startsWith('/api/') && MUTATING.has(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return NextResponse.json(
        { error: 'forbidden', message: 'Cross-site request rejected' },
        { status: 403 },
      );
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    '';
  // MSG91 widget sessions and development sessions are verified locally.
  if (!url || !key || localSessionAuthEnabled()) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('content-security-policy', csp);
        for (const { name, value, options } of list) {
          response.cookies.set({ name, value, ...(options ?? {}) });
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
