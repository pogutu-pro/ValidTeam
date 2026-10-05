import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { attachments, db, documentPageAttachments, sql, systemAuditLogs } from '@validteam/db';
import {
  buildStorageConfig,
  getStorageConfig,
  isFilesystemRootStorage,
  resolveEnvironmentStorageConfig,
  resolveStoredStorageConfig,
  sanitizeStorageConfig,
  STORAGE_CONFIG_ADVISORY_LOCK,
  storageBackendIdentity,
  upsertStorageConfig,
} from '@/lib/admin/system-settings';

const bodySchema = z.object({
  uploadsDir: z.string().trim().max(512).default(''),
  s3Bucket: z.string().trim().max(255).default(''),
  s3Region: z.string().trim().max(64).default(''),
  s3Endpoint: z.union([z.string().trim().url(), z.literal('')]).default(''),
  s3ForcePathStyle: z.boolean().default(false),
  s3AccessKey: z.string().trim().max(255).default(''),
  s3SecretKey: z.string().max(2048).optional(),
});

type StorageConfigErrorCode =
  | 'storage_s3_config_incomplete'
  | 'storage_local_root_forbidden'
  | 'storage_backend_change_blocked';

class StorageConfigError extends Error {
  constructor(
    readonly code: StorageConfigErrorCode,
    readonly status: number,
    readonly attachmentCount?: number
  ) {
    super(code);
    this.name = 'StorageConfigError';
  }
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  const admin = await isSuperAdmin();
  if (!admin) {
    return {
      error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    } as const;
  }
  return { userId: session.user.id } as const;
}

export async function GET() {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const config = await getStorageConfig();
  return NextResponse.json({ storage: sanitizeStorageConfig(config) });
}

export async function PUT(request: NextRequest) {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 }
    );
  }

  try {
    const saved = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );

      const currentStored = await getStorageConfig(tx);
      const currentResolved =
        resolveStoredStorageConfig(currentStored) ?? resolveEnvironmentStorageConfig();
      const candidate = buildStorageConfig(parsed.data, currentStored, authz.userId);
      const hasS3Intent = Boolean(
        candidate.s3Bucket ||
          candidate.s3Region ||
          candidate.s3Endpoint ||
          candidate.s3ForcePathStyle ||
          candidate.s3AccessKey ||
          parsed.data.s3SecretKey?.trim()
      );

      if (
        hasS3Intent &&
        !(
          candidate.s3Bucket &&
          candidate.s3Region &&
          candidate.s3AccessKey &&
          candidate.s3SecretKey
        )
      ) {
        throw new StorageConfigError('storage_s3_config_incomplete', 400);
      }

      const candidateResolved =
        resolveStoredStorageConfig(candidate) ?? resolveEnvironmentStorageConfig();
      if (isFilesystemRootStorage(candidateResolved)) {
        throw new StorageConfigError('storage_local_root_forbidden', 400);
      }

      if (storageBackendIdentity(currentResolved) !== storageBackendIdentity(candidateResolved)) {
        const [issueAttachmentCount] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(attachments);
        const [documentAttachmentCount] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(documentPageAttachments);
        const attachmentCount =
          (issueAttachmentCount?.value ?? 0) + (documentAttachmentCount?.value ?? 0);

        if (attachmentCount > 0) {
          throw new StorageConfigError('storage_backend_change_blocked', 409, attachmentCount);
        }
      }

      const next = await upsertStorageConfig(parsed.data, authz.userId, tx);
      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: authz.userId,
        action: 'system.storage_config_updated',
        resourceType: 'system_setting',
        resourceId: 'storage_config',
        metadata: {
          uploadsDir: next.uploadsDir,
          s3Bucket: next.s3Bucket,
          s3Region: next.s3Region,
          s3Endpoint: next.s3Endpoint || null,
          s3ForcePathStyle: next.s3ForcePathStyle,
          secretRotated: Boolean(parsed.data.s3SecretKey?.trim()),
        },
      });
      return next;
    });

    return NextResponse.json({ storage: sanitizeStorageConfig(saved) });
  } catch (error) {
    if (error instanceof StorageConfigError) {
      return NextResponse.json(
        {
          error: error.code,
          code: error.code,
          ...(error.attachmentCount === undefined
            ? {}
            : { attachmentCount: error.attachmentCount }),
        },
        { status: error.status }
      );
    }

    console.error('[admin/storage] failed to update storage configuration:', error);
    return NextResponse.json(
      { error: 'storage_config_update_failed', code: 'storage_config_update_failed' },
      { status: 500 }
    );
  }
}
