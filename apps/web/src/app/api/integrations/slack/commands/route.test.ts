/** @jest-environment node */

import { NextRequest } from 'next/server';

const callSlackApiMock = jest.fn();
const handleSlashCommandMock = jest.fn();
const resolveSlackOrgMock = jest.fn();

jest.mock('@/lib/integrations/slack', () => ({
  getSlackSigningSecret: () => 'signing-secret',
  verifySlackSignature: () => true,
  parseSlashCommand: (text: string) => ({ verb: 'new', args: [text], raw: text }),
  callSlackApi: (...args: unknown[]) => callSlackApiMock(...args),
}));
jest.mock('@/lib/integrations/slack-commands', () => ({
  handleSlashCommand: (...args: unknown[]) => handleSlashCommandMock(...args),
  resolveSlackOrg: (...args: unknown[]) => resolveSlackOrgMock(...args),
}));
jest.mock('@/lib/i18n/config', () => ({ defaultLocale: 'en' }));
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => {
    const messages: Record<string, string> = {
      modalTitle: 'New issue from Slack',
      modalSubmit: 'Create',
      modalCancel: 'Cancel',
      modalTitleLabel: 'Title',
      modalDescriptionStandaloneLabel: 'Description',
      modalStandaloneProjectLabel: 'Project key (required, e.g. TN)',
      modalOpenFailed: 'The new-issue modal could not be opened. Try again.',
    };
    return messages[key] ?? key;
  },
}));
jest.mock('@validteam/db/src/schema/integration-connections', () => ({
  integrationConnections: {
    id: 'integration.id',
    provider: 'integration.provider',
    externalAccountId: 'integration.externalAccountId',
    accessTokenEnc: 'integration.accessTokenEnc',
  },
}));
jest.mock('@validteam/db', () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ accessTokenEnc: 'encrypted-token' }],
        }),
      }),
    }),
  },
}));

import { POST } from './route';

function request() {
  const rawBody = new URLSearchParams({
    team_id: 'T123',
    channel_id: 'C123',
    user_id: 'U123',
    user_name: 'alice',
    trigger_id: 'trigger.123',
    text: 'Investigate regression',
  }).toString();
  return new NextRequest('http://localhost/api/integrations/slack/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': '123',
      'X-Slack-Signature': 'v0=signed',
    },
    body: rawBody,
  });
}

describe('Slack /tn new modal lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveSlackOrgMock.mockResolvedValue({
      organizationId: 'org_1',
      connectionId: 'connection_1',
      locale: 'en',
    });
    handleSlashCommandMock.mockResolvedValue({
      response_type: 'ephemeral',
      text: 'Opening the new-issue modal.',
    });
    callSlackApiMock.mockResolvedValue({ ok: true, data: {} });
  });

  it('waits for views.open, sends a localized required-project modal, and uses a tight timeout', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: 'Opening the new-issue modal.',
    });
    expect(callSlackApiMock).toHaveBeenCalledWith(
      'views.open',
      'encrypted-token',
      expect.objectContaining({
        trigger_id: 'trigger.123',
        view: expect.objectContaining({
          title: { type: 'plain_text', text: 'New issue from Slack' },
          blocks: expect.arrayContaining([
            expect.objectContaining({
              block_id: 'project',
              label: { type: 'plain_text', text: 'Project key (required, e.g. TN)' },
            }),
          ]),
        }),
      }),
      { timeoutMs: 2_500 }
    );
  });

  it('replaces the optimistic command reply when Slack does not open the modal', async () => {
    callSlackApiMock.mockResolvedValue({ ok: false, error: 'invalid_trigger' });

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({
      response_type: 'ephemeral',
      text: 'The new-issue modal could not be opened. Try again.',
    });
  });
});
