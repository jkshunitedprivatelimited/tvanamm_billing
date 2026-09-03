/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jksh/config', '@jksh/contracts', '@jksh/db', '@jksh/identity'],
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  // Workspace packages import sibling modules with an explicit `.js` extension
  // (NodeNext style) while the files on disk are `.ts`. Teach both bundlers to
  // resolve `.js` specifiers to their TypeScript source.
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
  },
};

export default nextConfig;
