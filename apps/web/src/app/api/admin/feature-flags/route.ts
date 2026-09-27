import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, featureFlags, organizations, systemAuditLogs } from '@tasknebula/db';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { desc, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';

export const dynamic = 'force-dynamic';

const createFeatureFlagSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9_-]+$/, 'Key must be lowercase alphanumeric with dashes or underscores'),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isEnabled: z.boolean().default(false),
  enabledForPlans: z
    .array(z.enum(['free', 'starter', 'growth', 'enterprise']))
    .max(4)
    .transform((values) => [...new Set(values)])
    .default([]),
  enabledForOrganizations: z
    .array(z.string().trim().min(1))
    .max(1000)
    .transform((values) => [...new Set(values)])
    .default([]),
  rolloutPercentage: z.number().min(0).max(100).default(0),
  metadata: z.record(z.any()).default({}),
});

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

// GET /api/admin/feature-flags - List all feature flags
export async function GET(request: NextRequest) {
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

    // Get all feature flags
    const flags = await db.select().from(featureFlags).orderBy(desc(featureFlags.createdAt));

    return NextResponse.json({
      featureFlags: flags,
      total: flags.length,
    });
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    return NextResponse.json({ error: 'Failed to fetch feature flags' }, { status: 500 });
  }
}

// POST /api/admin/feature-flags - Create new feature flag
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const validatedData = createFeatureFlagSchema.parse(body);

    const result = await db.transaction(async (tx) => {
      if (validatedData.enabledForOrganizations.length > 0) {
        const targetRows = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(inArray(organizations.id, validatedData.enabledForOrganizations));
        if (targetRows.length !== validatedData.enabledForOrganizations.length) {
          return { kind: 'invalid_organizations' as const };
        }
      }

      const [newFlag] = await tx
        .insert(featureFlags)
        .values({
          id: createId(),
          ...validatedData,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        })
        .returning();
      if (!newFlag) throw new Error('feature_flag_create_failed');

      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: 'feature_flag.created',
        resourceType: 'feature_flag',
        resourceId: newFlag.id,
        changes: {
          isEnabled: { from: null, to: newFlag.isEnabled },
          rolloutPercentage: { from: null, to: newFlag.rolloutPercentage },
        },
        metadata: {
          flagKey: newFlag.key,
          flagName: newFlag.name,
        },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return { kind: 'created' as const, newFlag };
    });

    if (result.kind === 'invalid_organizations') {
      return NextResponse.json(
        { error: 'feature_flag_target_organization_not_found' },
        { status: 400 }
      );
    }

    return NextResponse.json(result.newFlag, { status: 201 });
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

    console.error('Error creating feature flag:', error);
    return NextResponse.json({ error: 'Failed to create feature flag' }, { status: 500 });
  }
}
