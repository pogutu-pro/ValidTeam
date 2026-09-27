import { resolveStdioAuth, resolveHttpAuth } from '../auth';

describe('resolveStdioAuth', () => {
  it('reads env vars', () => {
    const ctx = resolveStdioAuth({
      TASKNEBULA_API_URL: 'https://x',
      TASKNEBULA_API_KEY: 'k',
    } as NodeJS.ProcessEnv);
    expect(ctx).toEqual({ apiUrl: 'https://x', apiKey: 'k' });
  });

  it('defaults apiUrl to localhost when unset', () => {
    const ctx = resolveStdioAuth({} as NodeJS.ProcessEnv);
    expect(ctx.apiUrl).toBe('http://localhost:3000');
    expect(ctx.apiKey).toBeUndefined();
  });
});

describe('resolveHttpAuth', () => {
  it('extracts a TaskNebula bearer key from Headers', () => {
    const headers = new Headers({ Authorization: 'Bearer sk_live_abc123' });
    const ctx = resolveHttpAuth({ headers }, {
      TASKNEBULA_API_URL: 'https://x',
    } as NodeJS.ProcessEnv);
    expect(ctx.accessToken).toBe('sk_live_abc123');
    expect(ctx.apiUrl).toBe('https://x');
  });

  it('returns no token when header is missing', () => {
    const ctx = resolveHttpAuth({ headers: new Headers() });
    expect(ctx.accessToken).toBeUndefined();
  });

  it('rejects malformed authorization header', () => {
    const headers = new Headers({ Authorization: 'Basic abc' });
    const ctx = resolveHttpAuth({ headers });
    expect(ctx.accessToken).toBeUndefined();
  });

  it.each(['Bearer opaque-oauth-token', 'Bearer sk_live_'])(
    'rejects a bearer credential that is not a usable TaskNebula key: %s',
    (authorization) => {
      const headers = new Headers({ Authorization: authorization });
      const ctx = resolveHttpAuth({ headers });
      expect(ctx.accessToken).toBeUndefined();
    }
  );
});
