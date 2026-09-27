import { buildContentSecurityPolicy, getSecurityHeaders } from '../headers';

function asHeaderMap(environment: string) {
  return new Map(getSecurityHeaders(environment).map(({ key, value }) => [key, value]));
}

describe('browser security headers', () => {
  it('builds a production CSP for the application runtime without development eval', () => {
    const policy = buildContentSecurityPolicy('production');

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' https: wss: ws:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("img-src 'self' data: blob: https:");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(policy).not.toMatch(/[\r\n]/);
  });

  it('allows eval only for the Next.js development runtime', () => {
    expect(buildContentSecurityPolicy('development')).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    );
    expect(buildContentSecurityPolicy('test')).not.toContain("'unsafe-eval'");
  });

  it('sets privacy and browser capability boundaries without requiring TLS', () => {
    const headers = asHeaderMap('production');

    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
    expect(headers.get('Permissions-Policy')).toBe(
      'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()'
    );
    expect(headers.has('Strict-Transport-Security')).toBe(false);
  });

  it('does not emit duplicate header names', () => {
    const headers = getSecurityHeaders('production');
    const names = headers.map(({ key }) => key.toLowerCase());

    expect(new Set(names).size).toBe(names.length);
  });
});
