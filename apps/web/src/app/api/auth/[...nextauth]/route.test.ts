/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockHandlerGet = jest.fn();
const mockHandlerPost = jest.fn();
const mockAuth = jest.fn();

jest.mock('@/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
  handlers: {
    GET: (...args: unknown[]) => mockHandlerGet(...args),
    POST: (...args: unknown[]) => mockHandlerPost(...args),
  },
}));

import { GET } from './route';

describe('Auth.js session boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null and expires stale JWT cookies when durable auth rejects the actor', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(new NextRequest('https://tasknebula.test/api/auth/session'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
    expect(response.headers.get('set-cookie')).toContain('authjs.session-token=');
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect(mockHandlerGet).not.toHaveBeenCalled();
  });

  it('preserves Auth.js response handling for a valid durable session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', sessionVersion: 2 } });
    mockHandlerGet.mockResolvedValue(Response.json({ user: { id: 'user-1' } }));
    const request = new NextRequest('http://localhost:3012/api/auth/session');

    const response = await GET(request);

    expect(mockHandlerGet).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toEqual({ user: { id: 'user-1' } });
  });

  it('leaves non-session Auth.js routes to the framework handler', async () => {
    mockHandlerGet.mockResolvedValue(Response.json({ providers: [] }));
    const request = new NextRequest('http://localhost:3012/api/auth/providers');

    await GET(request);

    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockHandlerGet).toHaveBeenCalledWith(request);
  });
});
