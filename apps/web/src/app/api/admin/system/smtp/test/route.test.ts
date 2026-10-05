/** @jest-environment node */

import { NextRequest } from 'next/server';

const authMock = jest.fn();
const isSuperAdminMock = jest.fn();
const resolveSmtpConfigMock = jest.fn();
const sendMailMock = jest.fn();
const getTranslationsMock = jest.fn(
  async () => (key: string, values?: Record<string, unknown>) =>
    key === 'testEmailSubject' ? 'Localized subject' : `Localized body ${values?.source}`
);
const auditEvents: string[] = [];
const auditRows: Array<Record<string, unknown>> = [];
let failingAuditAction: string | null = null;

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@/lib/auth/permissions', () => ({
  isSuperAdmin: (...args: unknown[]) => isSuperAdminMock(...args),
}));
jest.mock('@/lib/admin/system-settings', () => ({
  resolveSmtpConfig: (...args: unknown[]) => resolveSmtpConfigMock(...args),
}));
jest.mock('next-intl/server', () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn((options: Record<string, unknown>) => ({
      sendMail: (message: Record<string, unknown>) => {
        auditEvents.push('send');
        return sendMailMock(message, options);
      },
    })),
  },
}));
jest.mock('@validteam/db', () => ({
  users: { id: 'users.id', email: 'users.email' },
  systemAuditLogs: { id: 'system_audit_logs.id' },
  eq: (...args: unknown[]) => args,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ email: 'admin@example.com' }],
        }),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (row.action === failingAuditAction) throw new Error('audit unavailable');
        auditRows.push(row);
        auditEvents.push(`audit:${String(row.action)}`);
      },
    }),
  },
}));

import nodemailer from 'nodemailer';
import { POST } from './route';

function request(body: unknown = {}) {
  return new NextRequest('http://localhost/api/admin/system/smtp/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/system/smtp/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents.length = 0;
    auditRows.length = 0;
    failingAuditAction = null;
    delete process.env.SMTP_ALLOW_INSECURE_TLS;
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    isSuperAdminMock.mockResolvedValue(true);
    resolveSmtpConfigMock.mockResolvedValue({
      source: 'db',
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      user: 'mailer',
      password: 'secret',
      emailFrom: 'ValidTeam <noreply@example.com>',
    });
    sendMailMock.mockResolvedValue({ messageId: 'message_1' });
  });

  it('records intent before sending, uses localized content, and records success', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      recipient: 'admin@example.com',
      messageId: 'message_1',
    });
    expect(auditEvents).toEqual([
      'audit:system.smtp_test_requested',
      'send',
      'audit:system.smtp_test_sent',
    ]);
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Localized subject', text: 'Localized body db' }),
      expect.not.objectContaining({ tls: expect.anything() })
    );
    expect(getTranslationsMock).toHaveBeenCalledWith('adminPanels.systemCredentials.smtp');
    expect(auditRows[1]?.metadata).toMatchObject({
      recipient: 'admin@example.com',
      messageId: 'message_1',
    });
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
  });

  it('records a failed outcome when the SMTP transport rejects the message', async () => {
    sendMailMock.mockRejectedValue(new Error('connection refused'));

    const response = await POST(request({ to: 'owner@example.com' }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'smtp_test_failed',
    });
    expect(auditEvents).toEqual([
      'audit:system.smtp_test_requested',
      'send',
      'audit:system.smtp_test_failed',
    ]);
  });

  it('rejects an invalid recipient before resolving credentials or sending', async () => {
    const response = await POST(request({ to: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(resolveSmtpConfigMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(auditEvents).toEqual([]);
  });

  it('reports an unrecorded success outcome without claiming the delivery failed', async () => {
    failingAuditAction = 'system.smtp_test_sent';

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'smtp_test_outcome_unrecorded',
      deliveryUncertain: true,
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unrecorded failed outcome explicitly', async () => {
    sendMailMock.mockRejectedValue(new Error('connection refused'));
    failingAuditAction = 'system.smtp_test_failed';

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'smtp_test_outcome_unrecorded',
      deliveryUncertain: true,
    });
  });
});
