/**
 * @jest-environment node
 */

const selectMock = jest.fn();

jest.mock('@tasknebula/db', () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
  },
  eq: (left: unknown, right: unknown) => ({ left, right }),
  systemSettings: {
    key: 'systemSettings.key',
    value: 'systemSettings.value',
  },
}));

import { encryptSecretEnvelope } from '../system-crypto';
import { resolveStorageConfig, sanitizeStorageConfig } from '../system-settings';

function rows(result: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(result),
  };
  return builder;
}

describe('storage system settings', () => {
  const originalEnvironment = { ...process.env };

  beforeAll(() => {
    process.env.AUTH_SECRET = 'storage-test-secret-that-is-long-enough';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.UPLOAD_DIR;
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('prefers a complete encrypted database S3 configuration', async () => {
    const secret = encryptSecretEnvelope('secret-key', 'admin-1');
    const value = {
      uploadsDir: '/local/fallback',
      s3Bucket: 'db-bucket',
      s3Region: 'eu-central-1',
      s3Endpoint: 'https://objects.example.test',
      s3ForcePathStyle: true,
      s3AccessKey: 'access-key',
      s3SecretKey: secret,
    };
    selectMock.mockReturnValue(rows([{ value }]));

    await expect(resolveStorageConfig()).resolves.toEqual({
      source: 'db',
      mode: 's3',
      bucket: 'db-bucket',
      region: 'eu-central-1',
      endpoint: 'https://objects.example.test',
      forcePathStyle: true,
      credentials: { accessKeyId: 'access-key', secretAccessKey: 'secret-key' },
    });
    expect(sanitizeStorageConfig({ ...value, updatedAt: undefined, updatedBy: undefined })).toEqual(
      expect.objectContaining({ configured: true, s3SecretKeyPreview: '••••-key' })
    );
  });

  it('falls back to the database local directory when S3 fields are partial', async () => {
    selectMock.mockReturnValue(
      rows([
        {
          value: {
            uploadsDir: '/srv/tasknebula/uploads',
            s3Bucket: 'partial-bucket',
            s3Region: '',
            s3Endpoint: '',
            s3ForcePathStyle: false,
            s3AccessKey: '',
            s3SecretKey: null,
          },
        },
      ])
    );

    await expect(resolveStorageConfig()).resolves.toEqual({
      source: 'db',
      mode: 'local',
      uploadsDir: '/srv/tasknebula/uploads',
    });
  });

  it('uses environment S3 with the SDK credential chain when the database is empty', async () => {
    selectMock.mockReturnValue(rows([]));
    process.env.S3_BUCKET = 'env-bucket';
    process.env.AWS_REGION = 'us-east-1';

    await expect(resolveStorageConfig()).resolves.toEqual({
      source: 'env',
      mode: 's3',
      bucket: 'env-bucket',
      region: 'us-east-1',
    });
  });
});
