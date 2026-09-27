/** @jest-environment node */

let storedRows: Array<{ value: unknown }> = [];
let readError: Error | null = null;

jest.mock('@tasknebula/db', () => ({
  systemSettings: { value: 'systemSettings.value', key: 'systemSettings.key' },
  systemAuditLogs: {},
  eq: (...args: unknown[]) => ({ eq: args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (readError) throw readError;
            return storedRows;
          },
        }),
      }),
    }),
  },
}));

import {
  __test__,
  SelfUpdateError,
  SelfUpdateStateError,
  type SelfUpdateJob,
} from '../self-update';

const backup = {
  id: 'job_12345678',
  status: 'pending' as const,
  required: true,
  directory: '/backups/job',
  startedAt: '2026-08-20T10:00:00.000Z',
  completedAt: null,
  database: null,
  uploads: null,
  manifest: null,
  failureReason: null,
};

const job: SelfUpdateJob = {
  id: 'job_12345678',
  status: 'requested',
  currentVersion: '1.0.0',
  targetVersion: '1.1.0',
  repository: 'example/tasknebula',
  imageTag: '1.1.0',
  digest: `sha256:${'a'.repeat(64)}`,
  imageRef: `example/tasknebula@sha256:${'a'.repeat(64)}`,
  backup,
  releaseUrl: 'https://example.com/releases/1.1.0',
  triggeredBy: 'admin_1',
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:02:00.000Z',
  requestedAt: '2026-08-20T10:02:00.000Z',
  completedAt: null,
  failureReason: null,
  webhookStatus: 202,
};

describe('self-update persisted state', () => {
  beforeEach(() => {
    storedRows = [];
    readError = null;
  });

  it('distinguishes an absent job from a database read failure', async () => {
    await expect(__test__.readSelfUpdateJob()).resolves.toBeNull();

    readError = new Error('connection lost');
    await expect(__test__.readSelfUpdateJob()).rejects.toBeInstanceOf(SelfUpdateStateError);
  });

  it('rejects malformed persisted backup state instead of silently dropping the job', async () => {
    storedRows = [{ value: { ...job, backup: { ...backup, root: true } } }];

    await expect(__test__.readSelfUpdateJob()).rejects.toMatchObject({
      name: 'SelfUpdateStateError',
      message: 'Stored self-update state is invalid',
    });
  });

  it('returns a fully validated persisted job', async () => {
    storedRows = [{ value: job }];

    await expect(__test__.readSelfUpdateJob()).resolves.toEqual(job);
  });

  it('allows an identical callback snapshot but rejects attempts to rewrite backup truth', () => {
    expect(__test__.validateCallbackBackup(job, backup)).toBe(job.backup);
    expect(() =>
      __test__.validateCallbackBackup(job, {
        ...backup,
        status: 'failed',
        completedAt: job.updatedAt,
        failureReason: 'rewritten',
      })
    ).toThrow(SelfUpdateError);
  });

  it('requires at least 32 bytes of webhook secret material', () => {
    expect(__test__.webhookSecretIsStrong('x'.repeat(31))).toBe(false);
    expect(__test__.webhookSecretIsStrong('x'.repeat(32))).toBe(true);
    expect(__test__.webhookSecretIsStrong('🔐'.repeat(8))).toBe(true);
  });
});
