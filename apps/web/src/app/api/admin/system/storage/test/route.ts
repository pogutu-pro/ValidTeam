import { createId } from '@paralleldrive/cuid2';
import { db, sql, systemAuditLogs } from '@tasknebula/db';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { resolveStorageConfig, STORAGE_CONFIG_ADVISORY_LOCK } from '@/lib/admin/system-settings';
import { deleteStoredFile, readStoredFile, writeStoredFile } from '@/lib/storage/blob-store';
import { isSuperAdmin } from '@/lib/auth/permissions';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  if (!(await isSuperAdmin())) {
    return {
      error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    } as const;
  }
  return { userId: session.user.id } as const;
}

export async function POST() {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const filename = `storage-probe-${createId()}.txt`;
  const body = Buffer.from(`ValidTeam storage probe ${createId()}`, 'utf8');

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );
      const config = await resolveStorageConfig();
      let objectWritten = false;

      try {
        await writeStoredFile(filename, body, 'text/plain', config);
        objectWritten = true;
        const roundTrip = await readStoredFile(filename, config);
        if (!roundTrip.equals(body)) {
          throw new Error('storage_probe_content_mismatch');
        }
        await deleteStoredFile(filename, config);
        objectWritten = false;

        await tx.insert(systemAuditLogs).values({
          id: createId(),
          userId: authz.userId,
          action: 'system.storage_test_ok',
          resourceType: 'system_setting',
          resourceId: 'storage_config',
          metadata: { source: config.source, mode: config.mode },
        });

        return { source: config.source, mode: config.mode };
      } catch (error) {
        if (objectWritten) {
          await deleteStoredFile(filename, config).catch(() => undefined);
        }
        throw error;
      }
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[admin/storage] storage probe failed:', error);
    try {
      await db.insert(systemAuditLogs).values({
        id: createId(),
        userId: authz.userId,
        action: 'system.storage_test_failed',
        resourceType: 'system_setting',
        resourceId: 'storage_config',
        metadata: { detail: detail.slice(0, 500) },
      });
    } catch (auditError) {
      console.error('[admin/storage] failed to audit storage probe failure:', auditError);
      return NextResponse.json(
        {
          success: false,
          error: 'storage_test_outcome_unrecorded',
          code: 'storage_test_outcome_unrecorded',
          deliveryUncertain: true,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'storage_test_failed', code: 'storage_test_failed' },
      { status: 502 }
    );
  }
}
