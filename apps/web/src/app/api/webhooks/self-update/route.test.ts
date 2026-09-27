/** @jest-environment node */

import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const handleCallbackMock = jest.fn();

jest.mock('@/lib/version/self-update', () => {
  class SelfUpdateError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly reason: string
    ) {
      super(message);
    }
  }
  class SelfUpdateStateError extends Error {}
  return {
    handleSelfUpdateCallback: (...args: unknown[]) => handleCallbackMock(...args),
    SelfUpdateError,
    SelfUpdateStateError,
  };
});

import { POST } from './route';
import { SelfUpdateError, SelfUpdateStateError } from '@/lib/version/self-update';

const secret = 'self-update-test-secret-with-at-least-32-bytes';
const jobId = 'job_12345678';
const artifact = {
  path: '/backups/file.dump',
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
};
const backup = {
  id: jobId,
  status: 'succeeded' as const,
  required: true,
  directory: '/backups/job',
  startedAt: '2026-08-20T10:00:00.000Z',
  completedAt: '2026-08-20T10:01:00.000Z',
  database: artifact,
  uploads: { ...artifact, path: '/backups/uploads.tar.gz' },
  manifest: { ...artifact, path: '/backups/manifest.json' },
  failureReason: null,
};

function signedRequest(payload: unknown, signatureOverride?: string) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return new NextRequest('http://localhost/api/webhooks/self-update', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tasknebula-timestamp': timestamp,
      'x-tasknebula-signature': signatureOverride ?? `sha256=${signature}`,
    },
    body,
  });
}

describe('POST /api/webhooks/self-update', () => {
  const originalSecret = process.env.TASKNEBULA_SELF_UPDATE_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.TASKNEBULA_SELF_UPDATE_WEBHOOK_SECRET = secret;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.TASKNEBULA_SELF_UPDATE_WEBHOOK_SECRET;
    else process.env.TASKNEBULA_SELF_UPDATE_WEBHOOK_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    handleCallbackMock.mockResolvedValue({ id: jobId, status: 'running' });
  });

  it('accepts a signed strict callback and forwards a validated backup snapshot', async () => {
    const response = await POST(
      signedRequest({ jobId, status: 'running', webhookStatus: 202, backup })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, jobId, status: 'running' });
    expect(handleCallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, status: 'running', backup })
    );
  });

  it.each([
    ['unknown top-level field', { jobId, status: 'running', root: true }],
    ['unknown backup field', { jobId, status: 'running', backup: { ...backup, root: true } }],
    [
      'malformed artifact digest',
      { jobId, status: 'running', backup: { ...backup, database: { ...artifact, sha256: 'bad' } } },
    ],
    [
      'negative artifact size',
      { jobId, status: 'running', backup: { ...backup, uploads: { ...artifact, sizeBytes: -1 } } },
    ],
    ['mismatched backup job', { jobId, status: 'running', backup: { ...backup, id: 'other_job' } }],
  ])('rejects %s before mutating state', async (_label, payload) => {
    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(400);
    expect(handleCallbackMock).not.toHaveBeenCalled();
  });

  it('rejects a bad signature before parsing the payload', async () => {
    const response = await POST(
      signedRequest({ jobId, status: 'running' }, `sha256=${'0'.repeat(64)}`)
    );

    expect(response.status).toBe(401);
    expect(handleCallbackMock).not.toHaveBeenCalled();
  });

  it('surfaces persistence outages as unavailable instead of a missing job', async () => {
    handleCallbackMock.mockRejectedValue(new SelfUpdateStateError('database unavailable'));

    const response = await POST(signedRequest({ jobId, status: 'running' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Self-update state is unavailable',
      reason: 'state_unavailable',
    });
  });

  it('preserves typed lifecycle errors from the state machine', async () => {
    handleCallbackMock.mockRejectedValue(
      new SelfUpdateError('Self-update job was not found', 404, 'invalid_target')
    );

    const response = await POST(signedRequest({ jobId, status: 'failed' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Self-update job was not found',
      reason: 'invalid_target',
    });
  });
});
