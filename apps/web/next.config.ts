import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { getSecurityHeaders } from './src/lib/security/headers';

// Wires next-intl's request config so `getRequestConfig` runs for every
// request that hits the App Router. Path is relative to this file.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Enable standalone output for optimized Docker deployment
  // This creates a minimal production build with only necessary files
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@validteam/types', '@validteam/mcp-server'],
  // Keep native/server worker entry points out of the webpack server bundle.
  // Pino's development transport resolves `lib/worker.js` relative to the
  // installed package; bundling it into `.next/server/vendor-chunks` breaks
  // that invariant and leaves data-heavy pages stuck in their loading state.
  serverExternalPackages: [
    '@validteam/db',
    'postgres',
    'drizzle-orm',
    'pino',
    'pino-pretty',
    'thread-stream',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
    ],
  },
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Enable compression
  compress: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
