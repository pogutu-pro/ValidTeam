/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const hasPermissionMock = jest.fn();
const deliverWebhookRequestMock = jest.fn();
const recordWebhookAttemptMock = jest.fn();
const signWebhookPayloadMock = jest.fn();

const webhook = {
  id: 'webhook_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  url: 'https://hooks.example.com/receive',
  secret: 'secret',
  events: ['issue.created'],
};

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));
jest.mock('@/lib/webhooks/dispatcher', () => ({
  WEBHOOK_EVENTS: ['issue.created', 'issue.updated'],
  deliverWebhookRequest: (...args: unknown[]) => deliverWebhookRequestMock(...args),
  recordWebhookAttempt: (...args: unknown[]) => recordWebhookAttemptMock(...args),
  signWebhookPayload: (...args: unknown[]) => signWebhookPayloadMock(...args),
}));
jest.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ eq: args }),
}));
jest.mock('@validteam/db', () => ({
  webhooks: { id: 'webhooks.id' },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [webhook],
        }),
      }),
    }),
  },
}));

import { POST } from './route';

const request = new NextRequest('http://localhost/api/webhooks/webhook_1/test', {
  method: 'POST',
});
const context = { params: Promise.resolve({ webhookId: 'webhook_1' }) };

describe('POST /api/webhooks/[webhookId]/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    hasPermissionMock.mockResolvedValue(true);
    signWebhookPayloadMock.mockReturnValue('signed');
    deliverWebhookRequestMock.mockResolvedValue({
      ok: true,
      statusCode: 204,
      responseBody: '',
      errorMessage: null,
      durationMs: 14,
    });
    recordWebhookAttemptMock.mockResolvedValue(true);
  });

  it('uses the shared hardened delivery path and records actor audit context', async () => {
    const response = await POST(request, context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      statusCode: 204,
      durationMs: 14,
    });
    expect(deliverWebhookRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'webhook_1',
        url: 'https://hooks.example.com/receive',
        event: 'webhook.test',
        signature: 'signed',
        deliveryId: expect.any(String),
      })
    );
    expect(recordWebhookAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'webhook_1',
        event: 'issue.created',
        audit: {
          userId: 'user_1',
          organizationId: 'org_1',
          projectId: 'project_1',
        },
      })
    );
  });

  it('returns a delivery-uncertain response when persistence fails after sending', async () => {
    recordWebhookAttemptMock.mockResolvedValue(false);

    const response = await POST(request, context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'webhook_test_outcome_untracked',
      delivery: { success: true, statusCode: 204 },
    });
  });

  it('reports remote HTTP failure without exposing the response body', async () => {
    deliverWebhookRequestMock.mockResolvedValue({
      ok: false,
      statusCode: 500,
      responseBody: 'upstream-secret',
      errorMessage: 'HTTP 500',
      durationMs: 9,
    });

    const response = await POST(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: false,
      statusCode: 500,
      durationMs: 9,
      error: 'webhook_test_http_error',
    });
    expect(JSON.stringify(body)).not.toContain('upstream-secret');
  });
});
