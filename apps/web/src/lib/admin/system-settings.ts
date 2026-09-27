import { createId } from '@paralleldrive/cuid2';
import path from 'node:path';
import { db, eq, systemSettings } from '@tasknebula/db';
import {
  decryptSecretEnvelope,
  encryptSecretEnvelope,
  isSecretEnvelope,
  toSecretPreview,
  type SecretEnvelope,
} from './system-crypto';

export const SMTP_CONFIG_KEY = 'smtp_config';
export const LIVEKIT_CONFIG_KEY = 'livekit_config';
export const STORAGE_CONFIG_KEY = 'storage_config';
export const STORAGE_CONFIG_ADVISORY_LOCK = 'tasknebula:storage-config:v1';

type SystemSettingsDbClient = Pick<typeof db, 'select' | 'insert' | 'update'>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmtpConfigStored = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: SecretEnvelope | null;
  emailFrom: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type SmtpConfigSanitized = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordPreview: string | null;
  emailFrom: string;
  updatedAt: string | null;
  updatedBy: string | null;
  configured: boolean;
};

export type SmtpConfigInput = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string | null; // optional on update (keep existing when empty)
  emailFrom: string;
};

export type LivekitConfigStored = {
  url: string;
  apiKey: string;
  apiSecret: SecretEnvelope | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type LivekitConfigSanitized = {
  url: string;
  apiKey: string;
  apiSecretPreview: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  configured: boolean;
};

export type LivekitConfigInput = {
  url: string;
  apiKey: string;
  apiSecret?: string | null; // optional on update
};

export type StorageConfigStored = {
  uploadsDir: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3AccessKey: string;
  s3SecretKey: SecretEnvelope | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type StorageConfigSanitized = {
  uploadsDir: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3AccessKey: string;
  s3SecretKeyPreview: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  configured: boolean;
};

export type StorageConfigInput = {
  uploadsDir: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3AccessKey: string;
  s3SecretKey?: string | null;
};

// ---------------------------------------------------------------------------
// Generic upsert
// ---------------------------------------------------------------------------

async function readRawSetting(
  key: string,
  client: SystemSettingsDbClient = db
): Promise<Record<string, unknown> | null> {
  const [setting] = await client
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  const value = setting?.value as Record<string, unknown> | undefined | null;
  return value ?? null;
}

async function writeRawSetting(
  key: string,
  category: string,
  description: string,
  value: Record<string, unknown>,
  userId: string,
  client: SystemSettingsDbClient = db
) {
  const now = new Date();
  await client
    .insert(systemSettings)
    .values({
      id: createId(),
      key,
      category,
      description,
      value,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { category, description, value, updatedAt: now, updatedBy: userId },
    });
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

export function normalizeSmtpConfig(value: unknown): SmtpConfigStored {
  const raw = (value as Record<string, unknown>) || {};
  const passwordCandidate = raw.password;
  return {
    host: typeof raw.host === 'string' ? raw.host : '',
    port:
      typeof raw.port === 'number' && Number.isFinite(raw.port)
        ? raw.port
        : typeof raw.port === 'string'
          ? parseInt(raw.port, 10) || 25
          : 25,
    secure: raw.secure === true,
    user: typeof raw.user === 'string' ? raw.user : '',
    password: isSecretEnvelope(passwordCandidate) ? passwordCandidate : null,
    emailFrom: typeof raw.emailFrom === 'string' ? raw.emailFrom : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getSmtpConfig(
  client: SystemSettingsDbClient = db
): Promise<SmtpConfigStored> {
  const raw = await readRawSetting(SMTP_CONFIG_KEY, client);
  return normalizeSmtpConfig(raw);
}

export function sanitizeSmtpConfig(config: SmtpConfigStored): SmtpConfigSanitized {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    passwordPreview: config.password ? config.password.preview : null,
    emailFrom: config.emailFrom,
    updatedAt: config.updatedAt ?? null,
    updatedBy: config.updatedBy ?? null,
    configured: Boolean(config.host),
  };
}

export async function upsertSmtpConfig(
  input: SmtpConfigInput,
  userId: string,
  client: SystemSettingsDbClient = db
): Promise<SmtpConfigStored> {
  const existing = await getSmtpConfig(client);

  let passwordEnvelope: SecretEnvelope | null = existing.password;
  const trimmedPassword = typeof input.password === 'string' ? input.password.trim() : '';
  if (trimmedPassword) {
    passwordEnvelope = encryptSecretEnvelope(trimmedPassword, userId);
  }

  const next: SmtpConfigStored = {
    host: input.host.trim(),
    port: input.port,
    secure: input.secure,
    user: input.user.trim(),
    password: passwordEnvelope,
    emailFrom: input.emailFrom.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  await writeRawSetting(
    SMTP_CONFIG_KEY,
    'integrations',
    'Platform SMTP credentials (used for invite, notification, and verification emails).',
    next as unknown as Record<string, unknown>,
    userId,
    client
  );

  return next;
}

export type ResolvedSmtpConfig = {
  source: 'db' | 'env';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  emailFrom: string;
};

/**
 * Resolve live SMTP settings, preferring the DB-stored config over env vars.
 * Returns null when nothing is configured at either layer.
 */
export async function resolveSmtpConfig(): Promise<ResolvedSmtpConfig | null> {
  try {
    const stored = await getSmtpConfig();
    if (stored.host) {
      const password = decryptSecretEnvelope(stored.password) || '';
      return {
        source: 'db',
        host: stored.host,
        port: stored.port,
        secure: stored.secure,
        user: stored.user,
        password,
        emailFrom: stored.emailFrom || process.env.EMAIL_FROM || 'ValidTeam <noreply@localhost>',
      };
    }
  } catch (err) {
    console.error('[system-settings] failed to read SMTP from DB, falling back to env:', err);
  }

  if (!process.env.SMTP_HOST) return null;
  return {
    source: 'env',
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    emailFrom: process.env.EMAIL_FROM || 'ValidTeam <noreply@localhost>',
  };
}

// ---------------------------------------------------------------------------
// LiveKit
// ---------------------------------------------------------------------------

export function normalizeLivekitConfig(value: unknown): LivekitConfigStored {
  const raw = (value as Record<string, unknown>) || {};
  const secretCandidate = raw.apiSecret;
  return {
    url: typeof raw.url === 'string' ? raw.url : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    apiSecret: isSecretEnvelope(secretCandidate) ? secretCandidate : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getLivekitConfigStored(
  client: SystemSettingsDbClient = db
): Promise<LivekitConfigStored> {
  const raw = await readRawSetting(LIVEKIT_CONFIG_KEY, client);
  return normalizeLivekitConfig(raw);
}

export function sanitizeLivekitConfig(config: LivekitConfigStored): LivekitConfigSanitized {
  return {
    url: config.url,
    apiKey: config.apiKey,
    apiSecretPreview: config.apiSecret ? config.apiSecret.preview : null,
    updatedAt: config.updatedAt ?? null,
    updatedBy: config.updatedBy ?? null,
    configured: Boolean(config.url && config.apiKey && config.apiSecret),
  };
}

export async function upsertLivekitConfig(
  input: LivekitConfigInput,
  userId: string,
  client: SystemSettingsDbClient = db
): Promise<LivekitConfigStored> {
  const existing = await getLivekitConfigStored(client);

  let secretEnvelope: SecretEnvelope | null = existing.apiSecret;
  const trimmedSecret = typeof input.apiSecret === 'string' ? input.apiSecret.trim() : '';
  if (trimmedSecret) {
    secretEnvelope = encryptSecretEnvelope(trimmedSecret, userId);
  }

  const next: LivekitConfigStored = {
    url: input.url.trim(),
    apiKey: input.apiKey.trim(),
    apiSecret: secretEnvelope,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  await writeRawSetting(
    LIVEKIT_CONFIG_KEY,
    'integrations',
    'Platform LiveKit server credentials (used for realtime audio/video rooms).',
    next as unknown as Record<string, unknown>,
    userId,
    client
  );

  return next;
}

export type ResolvedLivekitConfig = {
  source: 'db' | 'env';
  url: string;
  apiKey: string;
  apiSecret: string;
};

/**
 * Resolve live LiveKit credentials, preferring the DB-stored config over env
 * vars. Returns null when nothing is configured at either layer.
 */
export async function resolveLivekitConfig(): Promise<ResolvedLivekitConfig | null> {
  try {
    const stored = await getLivekitConfigStored();
    const apiSecret = decryptSecretEnvelope(stored.apiSecret);
    if (stored.url && stored.apiKey && apiSecret) {
      return {
        source: 'db',
        url: stored.url,
        apiKey: stored.apiKey,
        apiSecret,
      };
    }
  } catch (err) {
    console.error('[system-settings] failed to read LiveKit from DB, falling back to env:', err);
  }

  const envUrl = process.env.LIVEKIT_URL || '';
  const envKey = process.env.LIVEKIT_API_KEY || '';
  const envSecret = process.env.LIVEKIT_API_SECRET || '';
  if (!envUrl || !envKey || !envSecret) return null;
  return {
    source: 'env',
    url: envUrl,
    apiKey: envKey,
    apiSecret: envSecret,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function normalizeStorageConfig(value: unknown): StorageConfigStored {
  const raw = (value as Record<string, unknown>) || {};
  const secretCandidate = raw.s3SecretKey;
  return {
    uploadsDir: typeof raw.uploadsDir === 'string' ? raw.uploadsDir : '',
    s3Bucket: typeof raw.s3Bucket === 'string' ? raw.s3Bucket : '',
    s3Region: typeof raw.s3Region === 'string' ? raw.s3Region : '',
    s3Endpoint: typeof raw.s3Endpoint === 'string' ? raw.s3Endpoint : '',
    s3ForcePathStyle: raw.s3ForcePathStyle === true,
    s3AccessKey: typeof raw.s3AccessKey === 'string' ? raw.s3AccessKey : '',
    s3SecretKey: isSecretEnvelope(secretCandidate) ? secretCandidate : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getStorageConfig(
  client: SystemSettingsDbClient = db
): Promise<StorageConfigStored> {
  const raw = await readRawSetting(STORAGE_CONFIG_KEY, client);
  return normalizeStorageConfig(raw);
}

export function sanitizeStorageConfig(config: StorageConfigStored): StorageConfigSanitized {
  return {
    uploadsDir: config.uploadsDir,
    s3Bucket: config.s3Bucket,
    s3Region: config.s3Region,
    s3Endpoint: config.s3Endpoint,
    s3ForcePathStyle: config.s3ForcePathStyle,
    s3AccessKey: config.s3AccessKey,
    s3SecretKeyPreview: config.s3SecretKey ? config.s3SecretKey.preview : null,
    updatedAt: config.updatedAt ?? null,
    updatedBy: config.updatedBy ?? null,
    configured: Boolean(
      config.uploadsDir ||
        (config.s3Bucket && config.s3Region && config.s3AccessKey && config.s3SecretKey)
    ),
  };
}

export type ResolvedStorageConfig =
  | {
      source: 'db' | 'env' | 'default';
      mode: 'local';
      uploadsDir: string;
    }
  | {
      source: 'db' | 'env';
      mode: 's3';
      bucket: string;
      region: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
    };

export function resolveStoredStorageConfig(
  stored: StorageConfigStored
): ResolvedStorageConfig | null {
  const secretAccessKey = decryptSecretEnvelope(stored.s3SecretKey);
  if (stored.s3Bucket && stored.s3Region && stored.s3AccessKey && secretAccessKey) {
    return {
      source: 'db',
      mode: 's3',
      bucket: stored.s3Bucket,
      region: stored.s3Region,
      ...(stored.s3Endpoint ? { endpoint: stored.s3Endpoint } : {}),
      ...(stored.s3ForcePathStyle ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: stored.s3AccessKey,
        secretAccessKey,
      },
    };
  }

  if (stored.uploadsDir) {
    return { source: 'db', mode: 'local', uploadsDir: stored.uploadsDir };
  }

  return null;
}

export function resolveEnvironmentStorageConfig(): ResolvedStorageConfig {
  const envBucket = process.env.S3_BUCKET?.trim();
  const envRegion = process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim();
  const envEndpoint = process.env.S3_ENDPOINT?.trim();
  if (envBucket && envRegion) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    return {
      source: 'env',
      mode: 's3',
      bucket: envBucket,
      region: envRegion,
      ...(envEndpoint ? { endpoint: envEndpoint } : {}),
      ...(process.env.S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    };
  }

  const envUploadsDir = process.env.UPLOAD_DIR?.trim();
  return envUploadsDir
    ? { source: 'env', mode: 'local', uploadsDir: envUploadsDir }
    : { source: 'default', mode: 'local', uploadsDir: './uploads' };
}

export function storageBackendIdentity(config: ResolvedStorageConfig): string {
  if (config.mode === 'local') {
    return `local:${path.resolve(process.cwd(), config.uploadsDir)}`;
  }

  const endpoint = (config.endpoint || 'aws').replace(/\/+$/, '').toLowerCase();
  return [
    's3',
    endpoint,
    config.region.toLowerCase(),
    config.bucket,
    config.forcePathStyle ? 'path' : 'virtual-host',
  ].join(':');
}

export function isFilesystemRootStorage(config: ResolvedStorageConfig): boolean {
  if (config.mode !== 'local') return false;
  const directory = path.resolve(process.cwd(), config.uploadsDir);
  return directory === path.parse(directory).root;
}

/**
 * Resolve the storage backend used by every attachment route. A complete
 * database S3 configuration wins, followed by the database local directory,
 * environment S3/local settings, and finally the repository-local uploads
 * directory. Partial database S3 credentials never create a half-configured
 * runtime client.
 */
export async function resolveStorageConfig(): Promise<ResolvedStorageConfig> {
  try {
    const stored = await getStorageConfig();
    const resolved = resolveStoredStorageConfig(stored);
    if (resolved) return resolved;
  } catch (err) {
    console.error('[system-settings] failed to read storage from DB, falling back to env:', err);
  }

  return resolveEnvironmentStorageConfig();
}

export function buildStorageConfig(
  input: StorageConfigInput,
  existing: StorageConfigStored,
  userId: string
): StorageConfigStored {
  let secretEnvelope: SecretEnvelope | null = existing.s3SecretKey;
  const trimmedSecret = typeof input.s3SecretKey === 'string' ? input.s3SecretKey.trim() : '';
  if (trimmedSecret) {
    secretEnvelope = encryptSecretEnvelope(trimmedSecret, userId);
  }

  return {
    uploadsDir: input.uploadsDir.trim(),
    s3Bucket: input.s3Bucket.trim(),
    s3Region: input.s3Region.trim(),
    s3Endpoint: input.s3Endpoint.trim(),
    s3ForcePathStyle: input.s3ForcePathStyle,
    s3AccessKey: input.s3AccessKey.trim(),
    s3SecretKey: secretEnvelope,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
}

export async function upsertStorageConfig(
  input: StorageConfigInput,
  userId: string,
  client: SystemSettingsDbClient = db
): Promise<StorageConfigStored> {
  const existing = await getStorageConfig(client);
  const next = buildStorageConfig(input, existing, userId);

  await writeRawSetting(
    STORAGE_CONFIG_KEY,
    'integrations',
    'Platform storage configuration (local uploads dir or S3-compatible bucket).',
    next as unknown as Record<string, unknown>,
    userId,
    client
  );

  return next;
}

export { toSecretPreview };
