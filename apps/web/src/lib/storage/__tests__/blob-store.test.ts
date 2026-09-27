/**
 * @jest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const resolveStorageConfigMock = jest.fn();
const s3SendMock = jest.fn();
const s3ClientMock = jest.fn();

jest.mock('@/lib/admin/system-settings', () => ({
  resolveStorageConfig: (...args: unknown[]) => resolveStorageConfigMock(...args),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    constructor(config: unknown) {
      s3ClientMock(config);
    }

    send(command: unknown) {
      return s3SendMock(command);
    }
  },
  PutObjectCommand: class PutObjectCommand {
    readonly kind = 'put';
    constructor(readonly input: unknown) {}
  },
  GetObjectCommand: class GetObjectCommand {
    readonly kind = 'get';
    constructor(readonly input: unknown) {}
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    readonly kind = 'delete';
    constructor(readonly input: unknown) {}
  },
}));

import {
  createStoredFilename,
  deleteStoredFile,
  readStoredFile,
  StorageObjectNotFoundError,
  validateStoredFilename,
  writeStoredFile,
} from '../blob-store';

describe('blob store', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'tasknebula-storage-test-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('normalizes the original extension without allowing path characters', () => {
    expect(createStoredFilename('file-id', 'Quarterly Report.PDF')).toBe('file-id.pdf');
    expect(createStoredFilename('file-id', '../../payload.<script>')).toBe('file-id.script');
    expect(createStoredFilename('file-id', 'README')).toBe('file-id');
    expect(() => validateStoredFilename('../secret')).toThrow(TypeError);
  });

  it('writes, reads, and physically deletes a file in the configured local directory', async () => {
    resolveStorageConfigMock.mockResolvedValue({
      source: 'db',
      mode: 'local',
      uploadsDir: temporaryDirectory,
    });

    await writeStoredFile('file-id.txt', Buffer.from('hello'), 'text/plain');
    await expect(readStoredFile('file-id.txt')).resolves.toEqual(Buffer.from('hello'));

    await deleteStoredFile('file-id.txt');
    await expect(readStoredFile('file-id.txt')).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(deleteStoredFile('file-id.txt')).resolves.toBeUndefined();
  });

  it('refuses to overwrite an existing local object', async () => {
    resolveStorageConfigMock.mockResolvedValue({
      source: 'db',
      mode: 'local',
      uploadsDir: temporaryDirectory,
    });

    await writeStoredFile('stable-id.txt', Buffer.from('first'), 'text/plain');
    await expect(
      writeStoredFile('stable-id.txt', Buffer.from('second'), 'text/plain')
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(readStoredFile('stable-id.txt')).resolves.toEqual(Buffer.from('first'));
  });

  it('uses the configured S3 bucket, region, credentials, and uploads prefix', async () => {
    resolveStorageConfigMock.mockResolvedValue({
      source: 'db',
      mode: 's3',
      bucket: 'attachments-bucket',
      region: 'eu-central-1',
      endpoint: 'https://objects.example.test',
      forcePathStyle: true,
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
    });
    s3SendMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => Uint8Array.from([104, 105]) },
      })
      .mockResolvedValueOnce({});

    await writeStoredFile('file-id.txt', Buffer.from('hi'), 'text/plain');
    await expect(readStoredFile('file-id.txt')).resolves.toEqual(Buffer.from('hi'));
    await deleteStoredFile('file-id.txt');

    expect(s3ClientMock).toHaveBeenCalledWith({
      region: 'eu-central-1',
      endpoint: 'https://objects.example.test',
      forcePathStyle: true,
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
    });
    expect(s3SendMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'put',
        input: expect.objectContaining({
          Bucket: 'attachments-bucket',
          Key: 'uploads/file-id.txt',
          ContentType: 'text/plain',
        }),
      })
    );
    expect(s3SendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'get',
        input: { Bucket: 'attachments-bucket', Key: 'uploads/file-id.txt' },
      })
    );
    expect(s3SendMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        kind: 'delete',
        input: { Bucket: 'attachments-bucket', Key: 'uploads/file-id.txt' },
      })
    );
  });
});
