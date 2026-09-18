/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

// CSP is set per-request (with a nonce) in src/proxy.ts. These are the static
// headers that do not need a nonce.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  // Production checks must not overwrite the running dev server's assets.
  distDir: isProd ? '.next-production' : '.next',
  agentRules: false,
  transpilePackages: ['@jksh/config', '@jksh/contracts', '@jksh/db', '@jksh/identity'],
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
