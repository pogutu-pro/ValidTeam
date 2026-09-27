/**
 * Browser security headers shared by every App Router and API response.
 *
 * This is intentionally a static CSP. A nonce-based policy would force every
 * otherwise-static page to render dynamically, which is a poor default for a
 * self-hosted application. Next.js emits small inline bootstrap scripts, so
 * `unsafe-inline` remains necessary until those scripts can be nonce-bound.
 */

export type SecurityHeader = {
  key: string;
  value: string;
};

export function buildContentSecurityPolicy(environment = process.env.NODE_ENV): string {
  const scriptSources = ["'self'", "'unsafe-inline'"];

  if (environment === 'development') {
    scriptSources.push("'unsafe-eval'");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws:",
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob:",
    "manifest-src 'self'",
  ].join('; ');
}

export function getSecurityHeaders(environment = process.env.NODE_ENV): SecurityHeader[] {
  return [
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(environment),
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'X-DNS-Prefetch-Control',
      value: 'off',
    },
    {
      key: 'X-Permitted-Cross-Domain-Policies',
      value: 'none',
    },
  ];
}
