/** @jest-environment node */

const resolveProjectCapabilityAccessMock = jest.fn();
const syncIssueLabelsMock = jest.fn();
const publishEventMock = jest.fn();
const triageMock = jest.fn();
const dispatchAuditMock = jest.fn();
const runAutomationsMock = jest.fn();
const triggerWebhooksMock = jest.fn();
const callSlackApiMock = jest.fn();
const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
const updatedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
const locks: unknown[] = [];
const eqCalls: unknown[][] = [];
let dbSelectResults: unknown[][] = [];
let txSelectResults: unknown[][] = [];
let idCounter = 0;

jest.mock('@paralleldrive/cuid2', () => ({
  createId: () => {
    idCounter += 1;
    return `generated_${idCounter}`;
  },
}));
jest.mock('next-intl/server', () => ({
  getTranslations:
    async () =>
    (key: string, values: Record<string, string> = {}) => {
      const templates: Record<string, string> = {
        bridgeFromSlack: 'From Slack',
        bridgePermalink: 'Permalink: {url}',
        bridgeAuthorInChannel: 'Author: <@{author}> in #{channel}',
        bridgeAuthor: 'Author: <@{author}>',
        bridgeEmptyMessage: '(no message text)',
        bridgeFallbackTitle: 'Slack: {message}',
        untitledSlackMessage: 'Untitled Slack message',
        bridgeConfirmationText: 'Created {issueKey} — {issueUrl}',
        bridgeConfirmationBlock: ':white_check_mark: <{issueUrl}|{issueKey}>',
      };
      return (templates[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
    },
}));
jest.mock('@/lib/i18n/config', () => ({
  defaultLocale: 'en',
  isSupportedLocale: (locale: unknown) => locale === 'en',
}));
jest.mock('@/lib/url/app-url', () => ({
  buildAppUrl: (path: string) => `https://app.example.com${path}`,
}));
jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) =>
    resolveProjectCapabilityAccessMock(...args),
}));
jest.mock('@/lib/labels/sync', () => ({
  syncIssueLabelsWithExecutor: (...args: unknown[]) => syncIssueLabelsMock(...args),
}));
jest.mock('@/lib/realtime/events', () => ({
  publishEventAwaitingFanOut: (...args: unknown[]) => publishEventMock(...args),
}));
jest.mock('@/lib/agents/triage-enqueue', () => ({
  runTriageOnce: (...args: unknown[]) => triageMock(...args),
}));
jest.mock('@/lib/audit/sink-dispatcher', () => ({
  dispatchAuditLogToSinks: (...args: unknown[]) => dispatchAuditMock(...args),
}));
jest.mock('@/lib/automation/evaluator', () => ({
  runAutomations: (...args: unknown[]) => runAutomationsMock(...args),
}));
jest.mock('@/lib/webhooks/dispatcher', () => ({
  triggerWebhooks: (...args: unknown[]) => triggerWebhooksMock(...args),
}));
jest.mock('./slack', () => ({
  callSlackApi: (...args: unknown[]) => callSlackApiMock(...args),
  postSlackMessage: jest.fn(),
}));
jest.mock('drizzle-orm', () => ({
  ne: (...args: unknown[]) => ({ ne: args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
jest.mock('@validteam/db', () => {
  function table(name: string, columns: string[]) {
    return Object.fromEntries([
      ['name', name],
      ...columns.map((column) => [column, `${name}.${column}`]),
    ]);
  }
  const tables = {
    issues: table('issues', ['id', 'key', 'number', 'projectId', 'organizationId']),
    organizations: table('organizations', ['id', 'status']),
    projects: table('projects', ['id', 'key', 'organizationId', 'defaultWorkflowId', 'status']),
    workflows: table('workflows', ['id', 'organizationId', 'isDefault']),
    workflowStatuses: table('workflow_statuses', ['id', 'workflowId', 'category']),
    integrationConnections: table('integration_connections', [
      'organizationId',
      'provider',
      'externalAccountId',
      'accessTokenEnc',
    ]),
    auditLogs: table('audit_logs', ['id']),
    issueActivities: table('issue_activities', ['id']),
    slackChannelRoutes: table('slack_channel_routes', [
      'organizationId',
      'slackTeamId',
      'slackChannelId',
      'projectId',
      'defaultLabel',
      'defaultPriority',
    ]),
    slackMessageLinks: table('slack_message_links', [
      'organizationId',
      'slackTeamId',
      'slackChannelId',
      'slackMessageTs',
      'slackThreadTs',
      'issueId',
    ]),
    users: table('users', ['id', 'locale']),
  };

  function chain(result: unknown[]) {
    const value: Record<string, unknown> = {};
    value.from = () => value;
    value.innerJoin = () => value;
    value.where = () => value;
    value.orderBy = () => value;
    value.limit = async () => result;
    return value;
  }

  const tx = {
    execute: async (query: unknown) => {
      locks.push(query);
    },
    select: () => chain(txSelectResults.shift() ?? []),
    insert: (target: { name: string }) => ({
      values: async (row: Record<string, unknown>) => {
        insertedRows.push({ table: target.name, row });
      },
    }),
  };

  const db = {
    select: () => chain(dbSelectResults.shift() ?? []),
    transaction: (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    update: (target: { name: string }) => ({
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          updatedRows.push({ table: target.name, row });
        },
      }),
    }),
  };

  return {
    db,
    ...tables,
    and: (...args: unknown[]) => ({ and: args }),
    eq: (...args: unknown[]) => {
      eqCalls.push(args);
      return { eq: args };
    },
    desc: (...args: unknown[]) => ({ desc: args }),
  };
});

import { createIssueFromSlackMessage } from './slack-issue-bridge';

const baseParams = {
  organizationId: 'org_1',
  slackTeamId: 'T123',
  slackChannelId: 'C123',
  slackMessageTs: '123.456',
  slackAuthorId: 'U_AUTHOR',
  permalink: 'https://slack.example/archive/123',
  title: 'Investigate regression',
  description: 'Customer report',
  projectId: 'project_1',
  messageText: 'The deployment is broken',
  channelName: 'triage',
  reporterUserId: 'user_1',
  extraLabels: ['customer'],
};

describe('Slack issue bridge lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insertedRows.length = 0;
    updatedRows.length = 0;
    locks.length = 0;
    eqCalls.length = 0;
    idCounter = 0;
    dbSelectResults = [
      [{ id: 'project_1', key: 'TN', organizationId: 'org_1', defaultWorkflowId: 'wf_1' }],
      [{ locale: 'en' }],
      [{ id: 'status_backlog' }],
      [{ defaultLabel: 'triage', defaultPriority: 'high' }],
      [{ accessTokenEnc: 'encrypted-token' }],
    ];
    txSelectResults = [[], [{ number: 4 }]];
    resolveProjectCapabilityAccessMock.mockResolvedValue({
      canRead: true,
      project: { organizationId: 'org_1' },
      permissions: { canCreateIssues: true },
    });
    syncIssueLabelsMock.mockResolvedValue(undefined);
    publishEventMock.mockResolvedValue(undefined);
    triageMock.mockResolvedValue(undefined);
    dispatchAuditMock.mockResolvedValue([]);
    runAutomationsMock.mockResolvedValue([]);
    triggerWebhooksMock.mockResolvedValue([]);
    callSlackApiMock.mockResolvedValue({ ok: true, data: { ts: 'reply.789' } });
  });

  it('commits issue, labels, activity, audit, and message link before scheduled fan-out', async () => {
    const scheduled: Array<() => Promise<void>> = [];
    const result = await createIssueFromSlackMessage({
      ...baseParams,
      scheduleAfterResponse: (task) => scheduled.push(task),
    });

    expect(result).toMatchObject({
      issue: { id: 'generated_1', key: 'TN-5', projectId: 'project_1' },
      threadTs: '123.456',
    });
    expect(locks).toHaveLength(2);
    expect(insertedRows.map(({ table }) => table)).toEqual([
      'issues',
      'issue_activities',
      'audit_logs',
      'slack_message_links',
    ]);
    const issue = insertedRows.find(({ table }) => table === 'issues')?.row;
    expect(issue).toMatchObject({
      priority: 'high',
      labels: ['customer', 'triage', 'slack'],
      statusId: 'status_backlog',
      reporterId: 'user_1',
    });
    expect(issue?.description).toContain('*From Slack*');
    expect(syncIssueLabelsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'generated_1',
        labels: ['customer', 'triage', 'slack'],
      }),
      expect.any(Object)
    );
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    await scheduled[0]!();

    expect(publishEventMock).toHaveBeenCalledWith(
      'issue.created',
      'user_1',
      expect.objectContaining({ issueId: 'generated_1', organizationId: 'org_1' })
    );
    expect(triageMock).toHaveBeenCalledWith('generated_1');
    expect(dispatchAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'issue.created', resourceId: 'generated_1' })
    );
    expect(runAutomationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'issue.created', actorUserId: 'user_1' })
    );
    expect(triggerWebhooksMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'issue.created', actorUserId: 'user_1' })
    );
    expect(callSlackApiMock).toHaveBeenCalledWith(
      'chat.postMessage',
      'encrypted-token',
      expect.objectContaining({ channel: 'C123', thread_ts: '123.456' })
    );
    expect(eqCalls).toContainEqual(['integration_connections.externalAccountId', 'T123']);
    expect(updatedRows).toEqual([
      { table: 'slack_message_links', row: { slackThreadTs: 'reply.789' } },
    ]);
  });

  it('returns the existing linked issue on a Slack retry without duplicating side effects', async () => {
    txSelectResults = [
      [
        {
          issueId: 'issue_existing',
          issueKey: 'TN-4',
          projectId: 'project_1',
          organizationId: 'org_1',
          threadTs: 'reply.old',
        },
      ],
    ];
    const scheduled: Array<() => Promise<void>> = [];

    const result = await createIssueFromSlackMessage({
      ...baseParams,
      scheduleAfterResponse: (task) => scheduled.push(task),
    });

    expect(result).toEqual({
      issue: {
        id: 'issue_existing',
        key: 'TN-4',
        projectId: 'project_1',
        organizationId: 'org_1',
      },
      threadTs: 'reply.old',
    });
    expect(insertedRows).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(callSlackApiMock).not.toHaveBeenCalled();
  });
});
