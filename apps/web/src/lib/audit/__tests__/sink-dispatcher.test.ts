/**
 * @jest-environment node
 *
 * Audit log sink dispatcher tests.
 *
 * Covered behaviors:
 *   1. Single sink — webhook receives an HMAC-signed POST and the success
 *      counter is incremented.
 *   2. Multiple sinks — every enabled sink for the workspace is delivered
 *      to exactly once, including mixed types (webhook + splunk + datadog).
 *   3. Partial failure — one sink's network error does NOT prevent delivery
 *      to the others; the dispatcher returns one result per sink.
 *   4. Replay protection — every outgoing request includes a unique
 *      X-ValidTeam-Nonce header. Two consecutive deliveries produce two
 *      different nonces.
 *
 * The DB layer is mocked so we don't need a real Postgres. We capture
 * inserts/updates to assert on bookkeeping.
 */

import crypto from 'crypto';

const mockPostPublicEndpoint = jest.fn(
  async (url: string, options: { headers: Record<string, string>; body: string }) => {
    const response = await global.fetch(url, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
    });
    return { ok: response.ok, status: response.status };
  }
);

jest.mock('@/lib/agents/provider-endpoint', () => ({
  postPublicEndpoint: (...args: unknown[]) => mockPostPublicEndpoint(...(args as [any, any, any])),
}));

// ---------------------------------------------------------------------------
// In-memory db mock
// ---------------------------------------------------------------------------

type SinkType = 'webhook' | 'splunk_hec' | 'datadog' | 's3';

interface SinkRow {
  id: string;
  workspaceId: string;
  enabled: boolean;
  type: SinkType;
  name: string;
  config: Record<string, unknown>;
  signingSecret: string;
  successCount: string;
  failureCount: string;
}

const state: {
  sinks: SinkRow[];
  updates: Array<{ id: string; set: Record<string, unknown> }>;
  selectWorkspaceId: string | null;
} = {
  sinks: [],
  updates: [],
  selectWorkspaceId: null,
};

jest.mock('@validteam/db', () => {
  const auditLogSinksTable = {
    __name: 'audit_log_sinks',
    id: 'audit_log_sinks.id',
    successCount: 'audit_log_sinks.success_count',
    failureCount: 'audit_log_sinks.failure_count',
  };

  const eq = (col: unknown, value: unknown) => ({ op: 'eq', col, value });
  const and = (...args: unknown[]) => ({ op: 'and', args });
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    text: strings.join('?'),
    values,
  });

  const db = {
    select() {
      return {
        from(table: { __name?: string }) {
          return {
            where(_cond: unknown) {
              if (table.__name === 'audit_log_sinks') {
                const wsId = state.selectWorkspaceId;
                const rows = state.sinks.filter((s) => s.workspaceId === wsId && s.enabled);
                return Promise.resolve(rows);
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    update(_table: { __name?: string }) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const id =
                cond && typeof cond === 'object' && 'value' in (cond as Record<string, unknown>)
                  ? ((cond as { value: unknown }).value as string)
                  : '__unknown__';
              const sink = state.sinks.find((candidate) => candidate.id === id);
              const captured = { ...values };
              if (sink && 'successCount' in values) {
                captured.successCount = String(Number(sink.successCount) + 1);
              }
              if (sink && 'failureCount' in values) {
                captured.failureCount = String(Number(sink.failureCount) + 1);
              }
              state.updates.push({ id, set: captured });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return {
    db,
    auditLogSinks: auditLogSinksTable,
    eq,
    and,
    sql,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(workspaceId: string, sinks: SinkRow[]) {
  state.sinks = sinks;
  state.updates = [];
  state.selectWorkspaceId = workspaceId;
}

function makeEvent(workspaceId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'log-1',
    workspaceId,
    action: 'issue.created',
    resourceType: 'issue',
    resourceId: 'i1',
    userId: 'u1',
    projectId: null,
    issueId: null,
    changes: null,
    metadata: null,
    createdAt: new Date('2026-05-14T12:00:00Z').toISOString(),
    ...overrides,
  };
}

// Import after jest.mock so the dispatcher picks up the mocked db.
import { dispatchAuditLogToSinks, signSinkPayload } from '../sink-dispatcher';

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;
beforeEach(() => {
  mockPostPublicEndpoint.mockClear();
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
});
afterAll(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// signSinkPayload primitive
// ---------------------------------------------------------------------------

describe('signSinkPayload', () => {
  it('produces stable HMAC-SHA256 hex output', () => {
    const expected = crypto.createHmac('sha256', 'k').update('hello').digest('hex');
    expect(signSinkPayload('hello', 'k')).toBe(expected);
  });

  it('changes when body changes', () => {
    expect(signSinkPayload('a', 'k')).not.toBe(signSinkPayload('b', 'k'));
  });
});

// ---------------------------------------------------------------------------
// Single sink
// ---------------------------------------------------------------------------

describe('dispatchAuditLogToSinks — single sink', () => {
  it('signs and POSTs to a webhook sink and increments successCount', async () => {
    resetState('org-1', [
      {
        id: 'sink-1',
        workspaceId: 'org-1',
        enabled: true,
        type: 'webhook',
        name: 'SIEM',
        config: { url: 'https://siem.example/ingest' },
        signingSecret: 'super-secret',
        successCount: '3',
        failureCount: '1',
      },
    ]);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    } as Response);

    const event = makeEvent('org-1');
    const results = await dispatchAuditLogToSinks(event);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sinkId: 'sink-1',
      type: 'webhook',
      ok: true,
      statusCode: 200,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe('https://siem.example/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers['X-ValidTeam-Sink-Id']).toBe('sink-1');
    expect(init.headers['X-ValidTeam-Event']).toBe('audit.issue.created');
    // Signature must match the body that was actually sent.
    const body = init.body as string;
    expect(init.headers['X-ValidTeam-Signature']).toBe(
      `sha256=${signSinkPayload(body, 'super-secret')}`
    );
    // Nonce header is present and non-empty.
    expect(init.headers['X-ValidTeam-Nonce']).toMatch(/^[a-f0-9]{32}$/);

    // Success counter bumped on the row.
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sink-1',
          set: expect.objectContaining({ successCount: '4' }),
        }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Multiple sinks
// ---------------------------------------------------------------------------

describe('dispatchAuditLogToSinks — multiple sinks', () => {
  it('delivers to every enabled sink (webhook + splunk + datadog) exactly once', async () => {
    resetState('org-2', [
      {
        id: 'sink-w',
        workspaceId: 'org-2',
        enabled: true,
        type: 'webhook',
        name: 'wh',
        config: { url: 'https://wh.example/ingest' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
      {
        id: 'sink-s',
        workspaceId: 'org-2',
        enabled: true,
        type: 'splunk_hec',
        name: 'splunk',
        config: { url: 'https://splunk.example/collector', token: 'tok' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
      {
        id: 'sink-d',
        workspaceId: 'org-2',
        enabled: true,
        type: 'datadog',
        name: 'dd',
        config: { apiKey: 'dd-key', site: 'datadoghq.com' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
      {
        // Disabled — must be skipped entirely.
        id: 'sink-off',
        workspaceId: 'org-2',
        enabled: false,
        type: 'webhook',
        name: 'off',
        config: { url: 'https://disabled.example' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    } as Response);

    const results = await dispatchAuditLogToSinks(makeEvent('org-2'));

    expect(results).toHaveLength(3);
    const byType = Object.fromEntries(results.map((r) => [r.type, r.ok]));
    expect(byType).toEqual({ webhook: true, splunk_hec: true, datadog: true });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0]);
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://wh.example/ingest',
        'https://splunk.example/collector',
        'https://http-intake.logs.datadoghq.com/api/v2/logs',
      ])
    );

    // Splunk request carries the Splunk token header.
    const splunkCall = (global.fetch as jest.Mock).mock.calls.find(
      (c) => c[0] === 'https://splunk.example/collector'
    )!;
    expect(splunkCall[1].headers['Authorization']).toBe('Splunk tok');

    // Datadog request carries DD-API-KEY header.
    const ddCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('http-intake.logs')
    )!;
    expect(ddCall[1].headers['DD-API-KEY']).toBe('dd-key');
  });
});

// ---------------------------------------------------------------------------
// Partial failure isolation
// ---------------------------------------------------------------------------

describe('dispatchAuditLogToSinks — failure isolation', () => {
  it('a single sink failure does not block the others', async () => {
    resetState('org-3', [
      {
        id: 'sink-good',
        workspaceId: 'org-3',
        enabled: true,
        type: 'webhook',
        name: 'good',
        config: { url: 'https://good.example/ingest' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
      {
        id: 'sink-bad',
        workspaceId: 'org-3',
        enabled: true,
        type: 'webhook',
        name: 'bad',
        config: { url: 'https://bad.example/ingest' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
    ]);

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('good.example')) {
        return Promise.resolve({
          ok: true,
          status: 204,
          text: () => Promise.resolve(''),
        } as Response);
      }
      return Promise.reject(new Error('econnrefused'));
    });

    const results = await dispatchAuditLogToSinks(makeEvent('org-3'));

    expect(results).toHaveLength(2);
    const good = results.find((r) => r.sinkId === 'sink-good')!;
    const bad = results.find((r) => r.sinkId === 'sink-bad')!;
    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('econnrefused');

    // Bookkeeping: good increments success, bad increments failure +
    // captures lastError.
    expect(state.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sink-good',
          set: expect.objectContaining({ successCount: '1' }),
        }),
        expect.objectContaining({
          id: 'sink-bad',
          set: expect.objectContaining({
            failureCount: '1',
            lastError: expect.stringContaining('econnrefused'),
          }),
        }),
      ])
    );
  });

  it('returns [] when no sinks are configured (no fetch)', async () => {
    resetState('org-empty', []);
    const results = await dispatchAuditLogToSinks(makeEvent('org-empty'));
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Replay protection (nonce)
// ---------------------------------------------------------------------------

describe('dispatchAuditLogToSinks — replay protection', () => {
  it('emits a unique X-ValidTeam-Nonce per delivery', async () => {
    resetState('org-4', [
      {
        id: 'sink-1',
        workspaceId: 'org-4',
        enabled: true,
        type: 'webhook',
        name: 'wh',
        config: { url: 'https://nonce.example/ingest' },
        signingSecret: 'k',
        successCount: '0',
        failureCount: '0',
      },
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    } as Response);

    await dispatchAuditLogToSinks(makeEvent('org-4', { id: 'log-A' }));
    await dispatchAuditLogToSinks(makeEvent('org-4', { id: 'log-B' }));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const nonceA = (
      (global.fetch as jest.Mock).mock.calls[0][1] as {
        headers: Record<string, string>;
      }
    ).headers['X-ValidTeam-Nonce'];
    const nonceB = (
      (global.fetch as jest.Mock).mock.calls[1][1] as {
        headers: Record<string, string>;
      }
    ).headers['X-ValidTeam-Nonce'];
    expect(nonceA).toMatch(/^[a-f0-9]{32}$/);
    expect(nonceB).toMatch(/^[a-f0-9]{32}$/);
    expect(nonceA).not.toBe(nonceB);
  });
});
