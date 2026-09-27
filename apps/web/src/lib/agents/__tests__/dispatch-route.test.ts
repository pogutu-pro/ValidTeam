/**
 * @jest-environment node
 *
 * dispatch-agent route flow test.
 *
 * Exercises POST /api/issues/[issueId]/dispatch-agent against a mocked
 * `@tasknebula/db`, mocked `auth`, and mocked global `fetch`. Asserts:
 *   - 401 when there is no session
 *   - 422 when the workspace has no provider configured for the requested
 *     provider key
 *   - 200 on the happy path, including:
 *       * a row inserted into agent_sessions
 *       * the outbound POST hitting the provider endpoint
 *       * a valid HMAC-SHA256 header signed with the provider secret
 *       * the AgentSessionRequest envelope shape (issue snapshot,
 *         callbackUrl, sessionId)
 *
 * We swap out the route's compile-time imports via `jest.mock` so the file
 * can be required without booting Next or hitting Postgres.
 */

// ----------------------------- DB mock ------------------------------------

type Row = Record<string, unknown>;

interface FakeQuery {
  inserted: Row[];
  updated: Array<{ table: string; set: Row }>;
  // Per-table fixtures keyed by table name.
  rows: Record<string, Row[]>;
}

const fake: FakeQuery = {
  inserted: [],
  updated: [],
  rows: {
    users: [],
    issues: [],
    projects: [],
    organization_members: [],
    project_members: [],
    agent_providers: [],
    agent_sessions: [],
    workflows: [],
    workflow_statuses: [],
  },
};

jest.mock('@tasknebula/db', () => {
  const tableSentinels = {
    users: { __name: 'users' },
    issues: { __name: 'issues' },
    projects: { __name: 'projects' },
    organizationMembers: { __name: 'organization_members' },
    projectMembers: { __name: 'project_members' },
    agentProviders: { __name: 'agent_providers' },
    agentSessions: { __name: 'agent_sessions' },
    workflows: { __name: 'workflows' },
    workflowStatuses: { __name: 'workflow_statuses' },
    issueComments: { __name: 'issue_comments' },
  } as const;

  const eq = (col: unknown, value: unknown) => ({ op: 'eq', col, value });
  const and = (...args: unknown[]) => ({ op: 'and', args });

  const db = {
    select(): {
      from: (table: { __name: string }) => {
        where: (cond: unknown) => {
          limit: (n: number) => Promise<Row[]>;
          then?: (resolve: (rows: Row[]) => unknown) => Promise<unknown>;
        };
      };
    } {
      return {
        from(table) {
          return {
            where(_cond: unknown) {
              const rows = fake.rows[table.__name] ?? [];
              const result = {
                limit: (_n: number) => Promise.resolve(rows.slice(0, _n)),
                then: (resolve: (rows: Row[]) => unknown) => Promise.resolve(rows).then(resolve),
              };
              return result;
            },
          };
        },
      };
    },
    insert(table: { __name: string }) {
      return {
        values(values: Row) {
          fake.inserted.push({ table: table.__name, ...values });
          // Provide deterministic ids so the route can echo them back.
          const id = (values.id as string | undefined) ?? `gen_${fake.inserted.length}`;
          const stored: Row = { ...values, id };
          fake.rows[table.__name] = [...(fake.rows[table.__name] ?? []), stored];
          return {
            returning: () => Promise.resolve([stored]),
          };
        },
      };
    },
    update(table: { __name: string }) {
      return {
        set(values: Row) {
          fake.updated.push({ table: table.__name, set: values });
          return { where: (_c: unknown) => Promise.resolve() };
        },
      };
    },
  };

  // `getIssueById` is a query helper; the route imports it directly. Return
  // the seeded issue row plus an `assignee` join shape.
  const getIssueById = async (issueId: string) => {
    const issue = (fake.rows.issues ?? []).find((r) => r.id === issueId);
    return issue ? { ...issue, assignee: null } : null;
  };

  // Tiny project-role defaults used by the route's permission gate.
  const ROLE_DEFAULT_PERMISSIONS = {
    viewer: { canAssignIssues: false },
    developer: { canAssignIssues: true },
    product_owner: { canAssignIssues: true },
    scrum_master: { canAssignIssues: true },
    tech_lead: { canAssignIssues: true },
    qa_engineer: { canAssignIssues: false },
    designer: { canAssignIssues: false },
  } as const;

  return {
    db,
    eq,
    and,
    or: (...a: unknown[]) => ({ op: 'or', args: a }),
    isNull: (c: unknown) => ({ op: 'isNull', c }),
    getIssueById,
    ROLE_DEFAULT_PERMISSIONS,
    ...tableSentinels,
  };
});

// ------------------------- next-auth mock ---------------------------------

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

const mockAiFeatureEnabled = jest.fn();
jest.mock('@/lib/ai/feature-gate', () => ({
  isAiFeatureEnabled: () => mockAiFeatureEnabled(),
  aiDisabledResponse: () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
}));

const mockProductFeatureEnabled = jest.fn();
jest.mock('@/lib/feature-flags', () => ({
  PRODUCT_FEATURE_FLAGS: { AGENT_DISPATCH: 'agent_dispatch' },
  isProductFeatureEnabled: (...args: unknown[]) => mockProductFeatureEnabled(...args),
}));

const mockResolveProjectCapabilityAccess = jest.fn();
jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) =>
    mockResolveProjectCapabilityAccess(...args),
}));

const mockResolveLocalAgentRunner = jest.fn();
const mockRunLocalAgentSession = jest.fn();
const mockValidateAgentProviderEndpoint = jest.fn();
const mockPostAgentProviderEndpoint = jest.fn();

jest.mock('@/lib/agents/local-runner', () => ({
  isLocalAgentEndpoint: (endpointUrl: string | null | undefined) =>
    Boolean(endpointUrl?.startsWith('local://')),
  resolveLocalAgentRunner: (...args: unknown[]) => mockResolveLocalAgentRunner(...args),
  runLocalAgentSession: (...args: unknown[]) => mockRunLocalAgentSession(...args),
}));

jest.mock('@/lib/agents/provider-endpoint', () => ({
  validateAgentProviderEndpoint: (...args: unknown[]) => mockValidateAgentProviderEndpoint(...args),
  postAgentProviderEndpoint: (...args: unknown[]) => mockPostAgentProviderEndpoint(...args),
}));

// --------------------------------------------------------------------------

import { auth as authMock } from '@/auth';

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
process.env.NEXT_PUBLIC_APP_URL = 'https://tasknebula.test';

// Pull the helpers we need _after_ the mocks above so the route picks them
// up.
import { POST as dispatchHandler } from '@/app/api/issues/[issueId]/dispatch-agent/route';
import { signAgentPayload } from '../sessions';

const originalFetch = global.fetch;

function seedHappyPath(opts: { hmacSecret: string }) {
  fake.inserted = [];
  fake.updated = [];
  fake.rows.users = [
    { id: 'user_caller', isSuperAdmin: true }, // super admin short-circuits perms
  ];
  fake.rows.issues = [
    {
      id: 'issue_1',
      key: 'TN-1',
      title: 'Wire agent dispatcher',
      description: 'Build the Linear Agent Protocol bridge.',
      priority: 'high',
      labels: ['backend'],
      projectId: 'proj_1',
      organizationId: 'org_1',
      reporterId: 'user_caller',
      assigneeId: null,
      statusId: 'status_open',
    },
  ];
  fake.rows.projects = [{ id: 'proj_1', organizationId: 'org_1' }];
  fake.rows.agent_providers = [
    {
      id: 'prov_1',
      workspaceId: 'org_1',
      provider: 'cursor',
      endpointUrl: 'https://cursor.example/agents/run',
      hmacSecret: opts.hmacSecret,
      enabled: true,
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  (authMock as unknown as jest.Mock).mockReset();
  fake.inserted = [];
  fake.updated = [];
  for (const k of Object.keys(fake.rows)) fake.rows[k] = [];
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  mockResolveLocalAgentRunner.mockReset();
  mockResolveLocalAgentRunner.mockReturnValue(null);
  mockRunLocalAgentSession.mockReset();
  mockRunLocalAgentSession.mockResolvedValue(undefined);
  mockValidateAgentProviderEndpoint.mockReset();
  mockValidateAgentProviderEndpoint.mockImplementation((value: string) =>
    Promise.resolve(new URL(value))
  );
  mockPostAgentProviderEndpoint.mockReset();
  mockAiFeatureEnabled.mockResolvedValue(true);
  mockProductFeatureEnabled.mockResolvedValue(true);
  mockResolveProjectCapabilityAccess.mockResolvedValue({
    canManage: true,
    permissions: { canAssignIssues: true },
  });
});

afterAll(() => {
  global.fetch = originalFetch;
  if (originalAppUrl === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  }
});

function buildRequest(body: unknown): {
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: Headers;
} {
  return {
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  };
}

describe('POST /api/issues/[id]/dispatch-agent', () => {
  it('returns 404 when agents are paused globally by the admin control plane', async () => {
    mockAiFeatureEnabled.mockResolvedValueOnce(false);

    const res = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });

    expect(res.status).toBe(404);
    expect(mockResolveProjectCapabilityAccess).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValueOnce(null);
    const res = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 422 when no provider is configured', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({
      user: { id: 'user_caller' },
    });
    seedHappyPath({ hmacSecret: 'unused' });
    fake.rows.agent_providers = []; // wipe provider config

    const res = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('returns 404 when the admin rollout flag disables agent dispatch', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({
      user: { id: 'user_caller' },
    });
    seedHappyPath({ hmacSecret: 'unused' });
    mockProductFeatureEnabled.mockResolvedValueOnce(false);

    const res = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });

    expect(res.status).toBe(404);
    expect(mockProductFeatureEnabled).toHaveBeenCalledWith('agent_dispatch', 'org_1');
  });

  it('signs the outbound dispatch and stores an agent_sessions row', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({
      user: { id: 'user_caller' },
    });
    const hmacSecret = 'workspace-hmac';
    seedHappyPath({ hmacSecret });

    mockPostAgentProviderEndpoint.mockResolvedValueOnce({
      ok: true,
      status: 202,
    });

    const res = await dispatchHandler(
      buildRequest({ provider: 'cursor', prompt_override: 'be fast' }) as never,
      { params: Promise.resolve({ issueId: 'issue_1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('active');
    expect(body.callbackUrl).toBe('https://tasknebula.test/api/webhooks/agent-session/cursor');

    // The provider URL was hit exactly once with a signed body.
    expect(mockPostAgentProviderEndpoint).toHaveBeenCalledTimes(1);
    const [url, init] = mockPostAgentProviderEndpoint.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://cursor.example/agents/run');
    const headers = init.headers;
    const rawBody = init.body;
    const expectedSig = signAgentPayload(rawBody, hmacSecret);
    expect(headers['X-TaskNebula-Signature']).toBe(`sha256=${expectedSig}`);
    expect(headers['X-TaskNebula-Event']).toBe('agent.session.dispatch');
    expect(headers['X-TaskNebula-Session-Id']).toBe(body.sessionId);

    // The envelope carries the right Linear-compatible bits.
    const parsed = JSON.parse(rawBody);
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionId: body.sessionId,
        actorUserId: 'user_caller',
        promptOverride: 'be fast',
        callbackUrl: 'https://tasknebula.test/api/webhooks/agent-session/cursor',
        issue: expect.objectContaining({
          id: 'issue_1',
          key: 'TN-1',
          title: 'Wire agent dispatcher',
          projectId: 'proj_1',
          organizationId: 'org_1',
          url: 'https://tasknebula.test/issues/issue_1',
        }),
      })
    );

    // We inserted a session row…
    const sessionInsert = fake.inserted.find((i) => i.table === 'agent_sessions');
    expect(sessionInsert).toMatchObject({
      issueId: 'issue_1',
      provider: 'cursor',
      state: 'pending',
    });
    // …and flipped it to active on the 2xx response.
    const flip = fake.updated.find((u) => u.table === 'agent_sessions');
    expect(flip?.set).toMatchObject({ state: 'active' });
  });

  it('returns 502 when the provider rejects the handoff', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({
      user: { id: 'user_caller' },
    });
    seedHappyPath({ hmacSecret: 's' });
    mockPostAgentProviderEndpoint.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const res = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.statusCode).toBe(503);

    const flip = fake.updated.find((u) => u.table === 'agent_sessions');
    expect(flip?.set).toMatchObject({ state: 'error' });
  });

  it('rejects an unsafe remote endpoint before creating a session', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({ user: { id: 'user_caller' } });
    seedHappyPath({ hmacSecret: 'unused' });
    mockValidateAgentProviderEndpoint.mockRejectedValue(new Error('private address'));

    const response = await dispatchHandler(buildRequest({ provider: 'cursor' }) as never, {
      params: Promise.resolve({ issueId: 'issue_1' }),
    });

    expect(response.status).toBe(422);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fake.inserted.find((row) => row.table === 'agent_sessions')).toBeUndefined();
  });

  it('dispatches directly to a configured local Codex runner without webhook fetch', async () => {
    (authMock as unknown as jest.Mock).mockResolvedValue({
      user: { id: 'user_caller' },
    });
    seedHappyPath({ hmacSecret: 'unused' });
    fake.rows.agent_providers = [];
    mockResolveLocalAgentRunner.mockReturnValue({
      provider: 'codex',
      command: 'codex',
      cwd: '/srv/tasknebula',
      model: null,
      timeoutMs: 3600000,
      maxTurns: null,
      codexSandbox: 'workspace-write',
      claudePermissionMode: 'auto',
      extraArgs: [],
      source: 'env',
    });

    const res = await dispatchHandler(
      buildRequest({ provider: 'codex', prompt_override: 'open a small PR' }) as never,
      { params: Promise.resolve({ issueId: 'issue_1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      provider: 'codex',
      state: 'active',
      runner: 'local_cli',
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRunLocalAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', command: 'codex' }),
      expect.objectContaining({
        sessionId: body.sessionId,
        provider: 'codex',
        promptOverride: 'open a small PR',
        issue: expect.objectContaining({
          id: 'issue_1',
          key: 'TN-1',
          reporterId: 'user_caller',
        }),
      })
    );
  });
});
