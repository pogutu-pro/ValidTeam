/**
 * High-level smoke tests for the HTTP handler. We exercise the
 * JSON-RPC discovery surface without depending on the MCP SDK runtime
 * (the handler short-circuits its own JSON-RPC dispatch).
 */
import { createMcpHttpHandler } from '../http';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

// Install a fetch shim so the handler's underlying client can mock REST.
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk_live_http_test',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('createMcpHttpHandler', () => {
  const handler = createMcpHttpHandler({
    env: { VALIDTEAM_API_URL: 'https://api.test' } as NodeJS.ProcessEnv,
  });

  it('serves discovery JSON on GET', async () => {
    const res = await handler(new Request('http://localhost/api/mcp', { method: 'GET' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transport).toBe('http+jsonrpc');
    expect(body.authorization.flow).toBe('oauth2.1-pkce');
    expect(body.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('rejects requests without Authorization', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it.each(['Bearer opaque-oauth-token', 'Bearer sk_live_', 'Basic sk_live_http_test'])(
    'rejects an unverified or malformed credential: %s',
    async (authorization) => {
      const res = await handler(
        jsonReq({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: authorization })
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({ error: { code: -32001 } });
    }
  );

  it('responds to initialize', async () => {
    const res = await handler(jsonReq({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('@validteam/mcp-server');
    expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('echoes an older protocol revision supported by the installed SDK', async () => {
    const res = await handler(
      jsonReq({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      })
    );
    const body = await res.json();

    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('lists 11 tools', async () => {
    const res = await handler(jsonReq({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const body = await res.json();
    expect(body.result.tools).toHaveLength(11);
  });

  it('treats capability discovery as syntax-gated, not proof that the key exists', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await handler(
      jsonReq(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { Authorization: 'Bearer sk_live_well_formed_but_unverified' }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.result.tools).toHaveLength(11);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a ValidTeam API key through a real tool call', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    const res = await handler(
      jsonReq(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'list_projects', arguments: {} },
        },
        { Authorization: 'Bearer sk_live_transport_test' }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(capturedUrl).toContain('/api/projects');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk_live_transport_test'
    );
  });

  it('returns Method not found for unknown method', async () => {
    const res = await handler(jsonReq({ jsonrpc: '2.0', id: 3, method: 'nope/foo' }));
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });
});
