/** @jest-environment node */

const afterMock = jest.fn();
const callSlackApiMock = jest.fn();
const resolveSlackOrgMock = jest.fn();
const lookupUserMock = jest.fn();
const createIssueMock = jest.fn();
const eqCalls: unknown[][] = [];
let selectResults: unknown[][] = [];

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (...args: unknown[]) => afterMock(...args) };
});
jest.mock('@/lib/integrations/slack', () => ({
  getSlackSigningSecret: () => 'signing-secret',
  verifySlackSignature: () => true,
  callSlackApi: (...args: unknown[]) => callSlackApiMock(...args),
}));
jest.mock('@/lib/integrations/slack-commands', () => ({
  resolveSlackOrg: (...args: unknown[]) => resolveSlackOrgMock(...args),
  lookupValidTeamUserBySlackId: (...args: unknown[]) => lookupUserMock(...args),
}));
jest.mock('@/lib/integrations/slack-issue-bridge', () => ({
  createIssueFromSlackMessage: (...args: unknown[]) => createIssueMock(...args),
}));
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values: Record<string, string>) => {
    if (key === 'untitledSlackMessage') return 'Untitled Slack message';
    if (key === 'reactionIssueTitle') return `:${values.reaction}: ${values.message}`;
    return key;
  },
}));
jest.mock('@validteam/db', () => {
  const slackChannelRoutes = {
    projectId: 'routes.projectId',
    emojiTrigger: 'routes.emojiTrigger',
    defaultLabel: 'routes.defaultLabel',
    organizationId: 'routes.organizationId',
    slackTeamId: 'routes.slackTeamId',
    slackChannelId: 'routes.slackChannelId',
  };
  const integrationConnections = {
    accessTokenEnc: 'integration.accessTokenEnc',
    connectedById: 'integration.connectedById',
    organizationId: 'integration.organizationId',
    provider: 'integration.provider',
    externalAccountId: 'integration.externalAccountId',
  };
  return {
    slackChannelRoutes,
    integrationConnections,
    and: (...args: unknown[]) => ({ and: args }),
    eq: (...args: unknown[]) => {
      eqCalls.push(args);
      return { eq: args };
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectResults.shift() ?? [],
          }),
        }),
      }),
    },
  };
});

import { NextRequest } from 'next/server';
import { POST } from './route';

describe('Slack reaction event lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eqCalls.length = 0;
    selectResults = [
      [{ projectId: 'project_1', emojiTrigger: 'ticket', defaultLabel: 'triage' }],
      [{ accessTokenEnc: 'encrypted-token', connectedById: 'user_installer' }],
    ];
    resolveSlackOrgMock.mockResolvedValue({ organizationId: 'org_1', locale: 'en' });
    lookupUserMock.mockResolvedValue('user_1');
    callSlackApiMock.mockImplementation(async (method: string) => {
      if (method === 'conversations.history') {
        return { ok: true, data: { messages: [{ ts: '123.456', text: '', user: 'U_AUTHOR' }] } };
      }
      return { ok: true, data: { permalink: 'https://slack.example/message' } };
    });
    createIssueMock.mockResolvedValue({ issue: { id: 'issue_1' }, threadTs: '123.456' });
  });

  it('acknowledges immediately and attaches the full handler to after()', async () => {
    const payload = {
      type: 'event_callback',
      team_id: 'T123',
      event: {
        type: 'reaction_added',
        user: 'U_REACTOR',
        reaction: 'ticket',
        item: { type: 'message', channel: 'C123', ts: '123.456' },
        event_ts: '123.999',
      },
    };
    const response = await POST(
      new NextRequest('http://localhost/api/integrations/slack/events', {
        method: 'POST',
        headers: {
          'X-Slack-Request-Timestamp': '123',
          'X-Slack-Signature': 'v0=signed',
        },
        body: JSON.stringify(payload),
      })
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(createIssueMock).not.toHaveBeenCalled();

    const task = afterMock.mock.calls[0]![0] as () => Promise<void>;
    await task();

    expect(lookupUserMock).toHaveBeenCalledWith('org_1', 'U_REACTOR', 'T123');
    expect(eqCalls).toContainEqual(['integration.externalAccountId', 'T123']);
    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        slackTeamId: 'T123',
        title: ':ticket: Untitled Slack message',
        projectId: 'project_1',
        reporterUserId: 'user_1',
      })
    );
  });
});
