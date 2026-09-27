import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageConfig, type ResolvedStorageConfig } from '@/lib/admin/system-settings';

const OBJECT_PREFIX = 'uploads';
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class StorageObjectNotFoundError extends Error {
  constructor(filename: string) {
    super(`Stored object not found: ${filename}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export function createStoredFilename(id: string, originalName: string): string {
  const candidate = originalName.includes('.') ? originalName.split('.').pop() : '';
  const extension = (candidate || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16);
  return extension ? `${id}.${extension}` : id;
}

export function validateStoredFilename(filename: string): string {
  if (!SAFE_FILENAME.test(filename) || filename === '.' || filename === '..') {
    throw new TypeError('Invalid stored filename');
  }
  return filename;
}

export function storedFilenameFromPath(storedPath: string): string {
  const filename = storedPath.split('/').pop() || '';
  return validateStoredFilename(filename);
}

function objectKey(filename: string) {
  return `${OBJECT_PREFIX}/${validateStoredFilename(filename)}`;
}

function resolveLocalDirectory(config: Extract<ResolvedStorageConfig, { mode: 'local' }>) {
  const directory = path.resolve(process.cwd(), config.uploadsDir);
  if (directory === path.parse(directory).root) {
    throw new Error('The filesystem root cannot be used as an uploads directory');
  }
  return directory;
}

function localFilePath(
  config: Extract<ResolvedStorageConfig, { mode: 'local' }>,
  filename: string
) {
  return path.join(resolveLocalDirectory(config), validateStoredFilename(filename));
}

function s3Client(config: Extract<ResolvedStorageConfig, { mode: 's3' }>) {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
  });
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; code?: string };
  return (
    candidate.name === 'NoSuchKey' || candidate.name === 'NotFound' || candidate.code === 'ENOENT'
  );
}

export async function writeStoredFile(
  filename: string,
  body: Buffer,
  contentType: string,
  storageConfig?: ResolvedStorageConfig
): Promise<void> {
  const config = storageConfig ?? (await resolveStorageConfig());
  validateStoredFilename(filename);

  if (config.mode === 'local') {
    const directory = resolveLocalDirectory(config);
    await mkdir(directory, { recursive: true });
    await writeFile(localFilePath(config, filename), body, { flag: 'wx' });
    return;
  }

  await s3Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey(filename),
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );
}

export async function readStoredFile(
  filename: string,
  storageConfig?: ResolvedStorageConfig
): Promise<Buffer> {
  const config = storageConfig ?? (await resolveStorageConfig());
  validateStoredFilename(filename);

  try {
    if (config.mode === 'local') {
      return await readFile(localFilePath(config, filename));
    }

    const result = await s3Client(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(filename) })
    );
    if (!result.Body) throw new StorageObjectNotFoundError(filename);
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError || isMissingObject(error)) {
      throw new StorageObjectNotFoundError(filename);
    }
    throw error;
  }
}

export async function deleteStoredFile(
  filename: string,
  storageConfig?: ResolvedStorageConfig
): Promise<void> {
  const config = storageConfig ?? (await resolveStorageConfig());
  validateStoredFilename(filename);

  try {
    if (config.mode === 'local') {
      await unlink(localFilePath(config, filename));
      return;
    }

    await s3Client(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey(filename) })
    );
  } catch (error) {
    // Deletes are idempotent: a record whose object is already absent can
    // still be removed without trapping users in an undeletable state.
    if (!isMissingObject(error)) throw error;
  }
}

export function attachmentContentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
