/** @jest-environment node */

import { NextRequest } from 'next/server';

const resolveSlackOrgMock = jest.fn();
const lookupUserMock = jest.fn();
const createIssueMock = jest.fn();
const postPublicEndpointMock = jest.fn();

jest.mock('@/lib/integrations/slack', () => ({
  getSlackSigningSecret: () => 'signing-secret',
  verifySlackSignature: () => true,
  callSlackApi: jest.fn(),
}));
jest.mock('@/lib/integrations/slack-commands', () => ({
  resolveSlackOrg: (...args: unknown[]) => resolveSlackOrgMock(...args),
  lookupValidTeamUserBySlackId: (...args: unknown[]) => lookupUserMock(...args),
}));
jest.mock('@/lib/integrations/slack-issue-bridge', () => ({
  createIssueFromSlackMessage: (...args: unknown[]) => createIssueMock(...args),
}));
jest.mock('@/lib/agents/provider-endpoint', () => ({
  postPublicEndpoint: (...args: unknown[]) => postPublicEndpointMock(...args),
}));
jest.mock('@/lib/i18n/config', () => ({ defaultLocale: 'en' }));
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => {
    const messages: Record<string, string> = {
      notInstalled: 'ValidTeam is not installed for this Slack workspace.',
      titleRequired: 'Title is required.',
      workspaceDisconnected: 'This Slack workspace is no longer connected.',
    };
    return messages[key] ?? key;
  },
}));
jest.mock('@validteam/db/src/schema/integration-connections', () => ({
  integrationConnections: {
    organizationId: 'integration.organizationId',
    provider: 'integration.provider',
    externalAccountId: 'integration.externalAccountId',
    accessTokenEnc: 'integration.accessTokenEnc',
  },
}));
jest.mock('@validteam/db', () => ({
  projects: { id: 'projects.id', organizationId: 'projects.organizationId', key: 'projects.key' },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  },
}));

import { POST } from './route';

function signedRequest(payload: unknown) {
  return new NextRequest('http://localhost/api/integrations/slack/interactivity', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': '123',
      'X-Slack-Signature': 'v0=signed',
    },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
  });
}

describe('Slack interactivity safety and localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveSlackOrgMock.mockResolvedValue(null);
    postPublicEndpointMock.mockResolvedValue({ ok: true, status: 200, body: '' });
  });

  it('posts an installation error only through the pinned Slack response-url policy', async () => {
    const response = await POST(
      signedRequest({
        type: 'message_action',
        callback_id: 'tn_create_from_message',
        trigger_id: 'trigger',
        team: { id: 'T123' },
        user: { id: 'U123' },
        channel: { id: 'C123' },
        message: { ts: '123.456', text: 'hello', user: 'U456' },
        response_url: 'https://hooks.slack.com/actions/T123/one/two',
      })
    );

    expect(response.status).toBe(200);
    expect(postPublicEndpointMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/actions/T123/one/two',
      expect.objectContaining({
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: 'ValidTeam is not installed for this Slack workspace.',
        }),
        signal: expect.any(AbortSignal),
      }),
      { hostAllowlist: ['hooks.slack.com', 'hooks.slack-gov.com'] }
    );
  });

  it('returns a localized Slack field error for an empty modal title', async () => {
    resolveSlackOrgMock.mockResolvedValue({ organizationId: 'org_1', locale: 'en' });

    const response = await POST(
      signedRequest({
        type: 'view_submission',
        team: { id: 'T123' },
        user: { id: 'U123' },
        view: {
          id: 'view_1',
          callback_id: 'tn_new_issue_modal',
          private_metadata: JSON.stringify({ teamId: 'T123' }),
          state: { values: { title: { value: { type: 'plain_text_input', value: '   ' } } } },
        },
      })
    );

    await expect(response.json()).resolves.toEqual({
      response_action: 'errors',
      errors: { title: 'Title is required.' },
    });
    expect(createIssueMock).not.toHaveBeenCalled();
  });
});
