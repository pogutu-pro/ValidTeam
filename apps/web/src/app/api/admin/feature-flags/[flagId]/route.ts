import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, featureFlags, organizations, systemAuditLogs } from '@validteam/db';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';

export const dynamic = 'force-dynamic';

const updateFeatureFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9_-]+$/, 'Key must be lowercase alphanumeric with dashes or underscores')
    .optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  isEnabled: z.boolean().optional(),
  enabledForPlans: z
    .array(z.enum(['free', 'starter', 'growth', 'enterprise']))
    .max(4)
    .transform((values) => [...new Set(values)])
    .optional(),
  enabledForOrganizations: z
    .array(z.string().trim().min(1))
    .max(1000)
    .transform((values) => [...new Set(values)])
    .optional(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  metadata: z.record(z.any()).optional(),
});

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

// GET /api/admin/feature-flags/[flagId] - Get single feature flag
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flagId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin();
    if (!isSuperAdminUser) {
      return NextResponse.json(
        { error: 'Forbidden - Super admin access required' },
        { status: 403 }
      );
    }

    const { flagId } = await params;

    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, flagId)).limit(1);

    if (!flag) {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 });
    }

    return NextResponse.json(flag);
  } catch (error) {
    console.error('Error fetching feature flag:', error);
    return NextResponse.json({ error: 'Failed to fetch feature flag' }, { status: 500 });
  }
}

// PATCH /api/admin/feature-flags/[flagId] - Update feature flag
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ flagId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin();
    if (!isSuperAdminUser) {
      return NextResponse.json(
        { error: 'Forbidden - Super admin access required' },
        { status: 403 }
      );
    }

    const { flagId } = await params;
    const body = await request.json();
    const validatedData = updateFeatureFlagSchema.parse(body);

    const result = await db.transaction(async (tx) => {
      const [oldFlag] = await tx
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.id, flagId))
        .limit(1)
        .for('update');
      if (!oldFlag) return { kind: 'not_found' as const };

      if (validatedData.enabledForOrganizations?.length) {
        const targetRows = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(inArray(organizations.id, validatedData.enabledForOrganizations));
        if (targetRows.length !== validatedData.enabledForOrganizations.length) {
          return { kind: 'invalid_organizations' as const };
        }
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const trackedFields = [
        'key',
        'name',
        'description',
        'isEnabled',
        'enabledForPlans',
        'enabledForOrganizations',
        'rolloutPercentage',
        'metadata',
      ] as const;

      for (const field of trackedFields) {
        const next = validatedData[field];
        if (next === undefined) continue;
        const previous = oldFlag[field];
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          changes[field] = { from: previous, to: next };
        }
      }

      if (Object.keys(changes).length === 0) {
        return { kind: 'updated' as const, updatedFlag: oldFlag };
      }

      const [updatedFlag] = await tx
        .update(featureFlags)
        .set({
          ...validatedData,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(featureFlags.id, flagId))
        .returning();
      if (!updatedFlag) throw new Error('feature_flag_update_failed');

      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: 'feature_flag.update',
        resourceType: 'feature_flag',
        resourceId: flagId,
        changes,
        metadata: { flagKey: updatedFlag.key, flagName: updatedFlag.name },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return { kind: 'updated' as const, updatedFlag };
    });

    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 });
    }
    if (result.kind === 'invalid_organizations') {
      return NextResponse.json(
        { error: 'feature_flag_target_organization_not_found' },
        { status: 400 }
      );
    }
    return NextResponse.json(result.updatedFlag);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'feature_flag_key_conflict' }, { status: 409 });
    }

    console.error('Error updating feature flag:', error);
    return NextResponse.json({ error: 'Failed to update feature flag' }, { status: 500 });
  }
}

// DELETE /api/admin/feature-flags/[flagId] - Delete feature flag
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ flagId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    const isSuperAdminUser = await isSuperAdmin();
    if (!isSuperAdminUser) {
      return NextResponse.json(
        { error: 'Forbidden - Super admin access required' },
        { status: 403 }
      );
    }

    const { flagId } = await params;

    const deleted = await db.transaction(async (tx) => {
      const [flag] = await tx
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.id, flagId))
        .limit(1)
        .for('update');
      if (!flag) return false;

      await tx.delete(featureFlags).where(eq(featureFlags.id, flagId));
      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: 'feature_flag.delete',
        resourceType: 'feature_flag',
        resourceId: flagId,
        metadata: { flagKey: flag.key, flagName: flag.name },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting feature flag:', error);
    return NextResponse.json({ error: 'Failed to delete feature flag' }, { status: 500 });
  }
}
