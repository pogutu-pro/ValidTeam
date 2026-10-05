import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { createId } from '@paralleldrive/cuid2';
import { db, sql, systemAuditLogs } from '@validteam/db';
import {
  getVersionUpdatePreferences,
  VERSION_UPDATE_PREFERENCES_ADVISORY_LOCK,
  VERSION_UPDATE_PREFERENCES_KEY,
  updateVersionUpdatePreferences,
} from '@/lib/version/preferences';

const preferencesSchema = z
  .object({
    bannerEnabled: z.boolean().optional(),
    availableUpdateNotificationsEnabled: z.boolean().optional(),
    postUpdateNotificationsEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'empty' });

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

  return NextResponse.json(await getVersionUpdatePreferences());
}

export async function PATCH(request: NextRequest) {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const body = await request.json().catch(() => null);
  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update preferences', reason: 'invalid_request' },
      { status: 400 }
    );
  }

  const preferences = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${VERSION_UPDATE_PREFERENCES_ADVISORY_LOCK}))`
    );
    const previous = await getVersionUpdatePreferences(tx, { fallbackOnError: false });
    const next = await updateVersionUpdatePreferences(parsed.data, authz.userId, tx);
    const changes = Object.fromEntries(
      Object.entries(parsed.data).map(([key, value]) => [
        key,
        {
          from: previous[key as keyof typeof previous],
          to: value,
        },
      ])
    );

    await tx.insert(systemAuditLogs).values({
      id: createId(),
      userId: authz.userId,
      action: 'version.preferences_updated',
      resourceType: 'system_setting',
      resourceId: VERSION_UPDATE_PREFERENCES_KEY,
      changes,
    });
    return next;
  });
  return NextResponse.json(preferences);
}
