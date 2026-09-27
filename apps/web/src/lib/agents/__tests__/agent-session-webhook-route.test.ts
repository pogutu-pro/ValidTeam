/**
 * @jest-environment node
 *
 * /api/webhooks/agent-session/[provider] receiver tests.
 *
 * Covers the inbound side of the Linear Agent Protocol bridge:
 *   - 401 when the HMAC header is missing or invalid
 *   - 401 when no session can be located
 *   - 400 when the body is not a valid AgentSessionEvent
 *   - happy path: a valid signature + good transition produces a 200, posts a
 *     comment, and updates the session row
 *   - invalid transition (complete -> active) is dropped (200, no row mutation)
 *
 * As with the dispatch test, we mock `@tasknebula/db` so the route handler
 * can run without Postgres.
 */

type Row = Record<string, unknown>;

interface FakeState {
  inserted: Row[];
  updated: Array<{ table: string; set: Row }>;
  rows: Record<string, Row[]>;
  userQueryRows: Row[][];
  joins: Array<{ from: string; joined: string }>;
}

const fake: FakeState = {
  inserted: [],
  updated: [],
  userQueryRows: [],
  joins: [],
  rows: {
    agent_sessions: [],
    agent_providers: [],
    issues: [],
    users: [],
    organization_members: [],
    organizations: [],
    workflows: [],
    workflow_statuses: [],
    agent_session_webhook_deliveries: [],
  },
};
let failCommentInsert = false;

jest.mock('@tasknebula/db', () => {
  const table = (name: string) => ({ __name: name });

  function selectRows(t: { __name: string }) {
    const rows =
      t.__name === 'users' && fake.userQueryRows.length > 0
        ? (fake.userQueryRows.shift() ?? [])
        : (fake.rows[t.__name] ?? []);
    const chain = {
      innerJoin: (joined: { __name: string }, _condition: unknown) => {
        fake.joins.push({ from: t.__name, joined: joined.__name });
        return chain;
      },
      where: (_c: unknown) => chain,
      orderBy: (..._args: unknown[]) => chain,
      limit: (count: number) => {
        const limited = rows.slice(0, count);
        const limitedChain = Promise.resolve(limited) as Promise<Row[]> & {
          for: (...args: unknown[]) => Promise<Row[]>;
        };
        limitedChain.for = (..._args: unknown[]) => Promise.resolve(limited);
        return limitedChain;
      },
      for: (..._args: unknown[]) => Promise.resolve(rows),
      then: (resolve: (value: Row[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  }

  const db = {
    select() {
      return {
        from(t: { __name: string }) {
          return selectRows(t);
        },
      };
    },
    insert(t: { __name: string }) {
      return {
        values(values: Row) {
          if (t.__name === 'issue_comments' && failCommentInsert) {
            throw new Error('comment insert failed');
          }
          const duplicate =
            t.__name === 'agent_session_webhook_deliveries' &&
            fake.rows.agent_session_webhook_deliveries.some(
              (row) =>
                row.workspaceId === values.workspaceId &&
                row.sessionId === values.sessionId &&
                row.fingerprint === values.fingerprint
            );
          if (!duplicate) {
            fake.inserted.push({ table: t.__name, ...values });
            (fake.rows[t.__name] ??= []).push({ ...values });
          }

          const operation = {
            onConflictDoNothing: () => operation,
            returning: (_selection?: unknown) =>
              Promise.resolve(duplicate ? [] : [{ ...values, id: values.id ?? 'inserted_1' }]),
            then: (resolve: (value: Row[]) => unknown) =>
              Promise.resolve(duplicate ? [] : [{ ...values }]).then(resolve),
          };
          return operation;
        },
      };
    },
    update(t: { __name: string }) {
      return {
        set(values: Row) {
          fake.updated.push({ table: t.__name, set: values });
          return {
            where: (_c: unknown) => {
              const rows = fake.rows[t.__name] ?? [];
              const target = rows[0];
              if (target) Object.assign(target, values);
              const result = target ? [{ ...target }] : [];
              const operation = Promise.resolve(result) as Promise<Row[]> & {
                returning: () => Promise<Row[]>;
              };
              operation.returning = () => Promise.resolve(result);
              return operation;
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: typeof db) => Promise<T>) {
      const snapshot = {
        rows: structuredClone(fake.rows),
        insertedLength: fake.inserted.length,
        updatedLength: fake.updated.length,
      };
      try {
        return await callback(db);
      } catch (error) {
        fake.rows = snapshot.rows;
        fake.inserted.length = snapshot.insertedLength;
        fake.updated.length = snapshot.updatedLength;
        throw error;
      }
    },
  };

  const getIssueById = async (issueId: string) => {
    const issue = (fake.rows.issues ?? []).find((r) => r.id === issueId);
    return issue ? { ...issue, assignee: null } : null;
  };

  const createComment = async (data: Row) => {
    fake.inserted.push({ table: 'issue_comments', ...data });
    return { ...data, id: 'comment_1' };
  };

  return {
    db,
    eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
    and: (...args: unknown[]) => ({ op: 'and', args }),
    or: (...args: unknown[]) => ({ op: 'or', args }),
    isNull: (c: unknown) => ({ op: 'isNull', c }),
    getIssueById,
    createComment,
    agentSessions: table('agent_sessions'),
    agentProviders: table('agent_providers'),
    issues: table('issues'),
    issueComments: table('issue_comments'),
    agentSessionWebhookDeliveries: table('agent_session_webhook_deliveries'),
    workflows: table('workflows'),
    workflowStatuses: table('workflow_statuses'),
    organizationMembers: table('organization_members'),
    organizations: table('organizations'),
    users: table('users'),
  };
});

import { POST as receiveHandler } from '@/app/api/webhooks/agent-session/[provider]/route';
import { signAgentPayload } from '../sessions';

function reqWith(
  body: unknown,
  headers: Record<string, string> = {}
): {
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  headers: Headers;
} {
  const raw = JSON.stringify(body);
  return {
    text: () => Promise.resolve(raw),
    json: () => Promise.resolve(body),
    headers: new Headers(headers),
  };
}

function seed(
  opts: {
    sessionState?: 'pending' | 'active' | 'complete' | 'error';
    signedSecret?: string;
    workspaceSecret?: string;
  } = {}
) {
  fake.inserted = [];
  fake.updated = [];
  fake.userQueryRows = [];
  fake.joins = [];
  fake.rows.agent_sessions = [
    {
      id: 'sess_1',
      issueId: 'issue_1',
      provider: 'cursor',
      externalId: null,
      state: opts.sessionState ?? 'pending',
      signedSecret: opts.signedSecret ?? 'per-session-secret',
      payload: {},
    },
  ];
  fake.rows.agent_providers = [
    {
      id: 'prov_1',
      workspaceId: 'org_1',
      provider: 'cursor',
      hmacSecret: opts.workspaceSecret ?? 'workspace-secret',
      enabled: true,
    },
  ];
  fake.rows.issues = [
    {
      id: 'issue_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      key: 'TN-1',
      title: 'Wire agents',
      reporterId: 'user_caller',
    },
  ];
  fake.rows.users = [];
  fake.rows.organizations = [{ id: 'org_1', status: 'active' }];
  fake.rows.workflows = [];
  fake.rows.workflow_statuses = [];
  fake.rows.agent_session_webhook_deliveries = [];
  failCommentInsert = false;
}

describe('POST /api/webhooks/agent-session/[provider]', () => {
  it('rejects unknown providers with 404', async () => {
    const res = await receiveHandler(reqWith({ state: 'active' }) as never, {
      params: Promise.resolve({ provider: 'bogus' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects missing signature with 401', async () => {
    seed();
    const res = await receiveHandler(
      reqWith(
        { state: 'active', sessionId: 'sess_1' },
        {
          'x-tasknebula-session-id': 'sess_1',
        }
      ) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );
    expect(res.status).toBe(401);
  });

  it('rejects a bad signature with 401', async () => {
    seed({ signedSecret: 'real-secret' });
    const body = { state: 'active', sessionId: 'sess_1' };
    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': 'sha256=deadbeef',
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );
    expect(res.status).toBe(401);
  });

  it('rejects valid callbacks while the workspace is suspended', async () => {
    seed({ signedSecret: 'top-secret' });
    fake.rows.organizations = [{ id: 'org_1', status: 'suspended' }];
    const body = { state: 'active', sessionId: 'sess_1' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const response = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(response.status).toBe(403);
    expect(fake.updated).toHaveLength(0);
    expect(fake.inserted).toHaveLength(0);
  });

  it('rejects an invalid AgentSessionEvent body with 400', async () => {
    seed({ signedSecret: 'real-secret' });
    const body = { state: 'bogus' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'real-secret');
    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );
    expect(res.status).toBe(400);
  });

  it('happy path: signed event drives pending -> active and posts a comment', async () => {
    seed({ sessionState: 'pending', signedSecret: 'top-secret' });
    const body = {
      state: 'active',
      sessionId: 'sess_1',
      message: 'Cloning repo',
    };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, sessionId: 'sess_1', state: 'active' });

    // Session row updated.
    const sessionUpdate = fake.updated.find((u) => u.table === 'agent_sessions');
    expect(sessionUpdate?.set).toMatchObject({ state: 'active' });

    // Comment posted on the linked issue.
    const comment = fake.inserted.find((i) => i.table === 'issue_comments');
    expect(comment?.content).toBe('Cursor started: Cloning repo');
    expect(comment?.createdBy).toBe('user_caller');
  });

  it('never attributes a comment to an agent from another organization', async () => {
    seed({ sessionState: 'pending', signedSecret: 'top-secret' });
    fake.rows.agent_sessions[0]!.payload = { dispatchedBy: 'user_dispatcher' };
    fake.rows.users = [{ id: 'agent_other_org', isAgent: true, agentProvider: 'cursor' }];
    fake.rows.organization_members = [
      { userId: 'agent_other_org', organizationId: 'org_other', status: 'active' },
      { userId: 'user_dispatcher', organizationId: 'org_1', status: 'active' },
    ];
    // The first tenant-scoped join finds no matching virtual agent. The
    // second validates dispatchedBy as an active member of this organization.
    fake.userQueryRows = [[], [{ id: 'user_dispatcher' }]];
    const body = { state: 'active', sessionId: 'sess_1', message: 'Working' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const response = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(response.status).toBe(200);
    expect(fake.inserted.find((row) => row.table === 'issue_comments')?.createdBy).toBe(
      'user_dispatcher'
    );
    expect(fake.joins).toEqual([
      { from: 'users', joined: 'organization_members' },
      { from: 'users', joined: 'organization_members' },
    ]);
  });

  it('concurrently deduplicates an identical same-state delivery before side effects', async () => {
    seed({ sessionState: 'active', signedSecret: 'top-secret' });
    const body = { state: 'active', sessionId: 'sess_1', message: 'Cloning repo' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');
    const request = () =>
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never;

    const [first, second] = await Promise.all([
      receiveHandler(request(), { params: Promise.resolve({ provider: 'cursor' }) }),
      receiveHandler(request(), { params: Promise.resolve({ provider: 'cursor' }) }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const responses = await Promise.all([first.json(), second.json()]);
    expect(responses.filter((response) => response.duplicate)).toHaveLength(1);
    expect(fake.inserted.filter((row) => row.table === 'issue_comments')).toHaveLength(1);
    expect(
      fake.inserted.filter((row) => row.table === 'agent_session_webhook_deliveries')
    ).toHaveLength(1);
  });

  it('rolls back the receipt and session CAS when a database side effect fails', async () => {
    seed({ sessionState: 'pending', signedSecret: 'top-secret' });
    const body = { state: 'active', sessionId: 'sess_1', message: 'Retry safely' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');
    const request = () =>
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never;

    failCommentInsert = true;
    const failed = await receiveHandler(request(), {
      params: Promise.resolve({ provider: 'cursor' }),
    });

    expect(failed.status).toBe(500);
    expect(fake.rows.agent_sessions[0]?.state).toBe('pending');
    expect(fake.rows.agent_session_webhook_deliveries).toHaveLength(0);

    failCommentInsert = false;
    const retried = await receiveHandler(request(), {
      params: Promise.resolve({ provider: 'cursor' }),
    });

    expect(retried.status).toBe(200);
    expect(fake.rows.agent_sessions[0]?.state).toBe('active');
    expect(fake.inserted.filter((row) => row.table === 'issue_comments')).toHaveLength(1);
  });

  it('treats same-state terminal callbacks as idempotent', async () => {
    seed({ sessionState: 'complete', signedSecret: 'top-secret' });
    const body = { state: 'complete', sessionId: 'sess_1', message: 'Done again' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const response = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dropped: true, duplicate: true });
    expect(fake.inserted.find((row) => row.table === 'issue_comments')).toBeUndefined();
    expect(fake.updated.find((row) => row.table === 'agent_sessions')).toBeUndefined();
  });

  it('completes the session but explicitly skips an unattributed workflow transition', async () => {
    seed({ sessionState: 'active', signedSecret: 'top-secret' });
    const body = { state: 'complete', sessionId: 'sess_1', message: 'Finished' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const response = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      state: 'complete',
      transitionSkipped: 'workflow_transition_actor_forbidden',
    });
    expect(fake.rows.issues[0]?.statusId).toBeUndefined();
    expect(
      fake.updated.find((row) => row.table === 'agent_session_webhook_deliveries')?.set
    ).toMatchObject({ lastError: 'workflow_transition_actor_forbidden' });
  });

  it('drops an invalid transition (complete -> active) with 200 and no mutation', async () => {
    seed({ sessionState: 'complete', signedSecret: 'top-secret' });
    const body = { state: 'active', sessionId: 'sess_1' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dropped).toBe(true);
    expect(json.state).toBe('complete');
    const sessionUpdate = fake.updated.find((u) => u.table === 'agent_sessions');
    expect(sessionUpdate).toBeUndefined();
  });

  it('accepts the provider-shared workspace secret as a fallback', async () => {
    seed({
      sessionState: 'pending',
      signedSecret: 'per-session',
      workspaceSecret: 'shared-workspace',
    });
    const body = { state: 'active', sessionId: 'sess_1' };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'shared-workspace');

    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'cursor' }) }
    );

    expect(res.status).toBe(200);
  });

  it('rejects a signed session event sent to a different provider endpoint', async () => {
    seed({ sessionState: 'pending', signedSecret: 'top-secret' });
    const body = {
      state: 'active',
      sessionId: 'sess_1',
      message: 'Wrong endpoint',
    };
    const raw = JSON.stringify(body);
    const sig = signAgentPayload(raw, 'top-secret');

    const res = await receiveHandler(
      reqWith(body, {
        'x-tasknebula-session-id': 'sess_1',
        'x-tasknebula-signature': `sha256=${sig}`,
      }) as never,
      { params: Promise.resolve({ provider: 'devin' }) }
    );

    expect(res.status).toBe(401);
    expect(fake.updated.find((u) => u.table === 'agent_sessions')).toBeUndefined();
    expect(fake.inserted.find((i) => i.table === 'issue_comments')).toBeUndefined();
  });
});
