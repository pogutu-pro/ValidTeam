/**
 * Super Admin API - Single Organization Management
 * GET /api/admin/organizations/[organizationId] - Get organization details
 * PATCH /api/admin/organizations/[organizationId] - Update organization
 * DELETE /api/admin/organizations/[organizationId] - Delete organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, organizations, systemAuditLogs } from '@tasknebula/db';
import { and, eq, ne } from 'drizzle-orm';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { createId } from '@paralleldrive/cuid2';

// GET /api/admin/organizations/[organizationId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const { organizationId } = await params;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json(org);
  } catch (error) {
    console.error('Failed to fetch organization:', error);
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 });
  }
}

// PATCH /api/admin/organizations/[organizationId]
const updateOrgSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    plan: z.enum(['free', 'starter', 'growth', 'enterprise']).optional(),
    status: z.enum(['active', 'trial', 'suspended']).optional(),
    domain: z.string().max(255).optional(),
    logoUrl: z.union([z.string().url(), z.literal('')]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const { organizationId } = await params;
    const body = await request.json();
    const data = updateOrgSchema.parse(body);

    const updatedOrg = await db.transaction(async (tx) => {
      const [currentOrg] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
        .for('update');
      if (!currentOrg) return null;

      if (data.slug) {
        const [existingOrg] = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(and(eq(organizations.slug, data.slug), ne(organizations.id, organizationId)))
          .limit(1);
        if (existingOrg) throw new Error('organization_slug_exists');
      }

      const [updated] = await tx
        .update(organizations)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(organizations.id, organizationId))
        .returning();
      if (!updated) throw new Error('organization_update_failed');

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['name', 'slug', 'plan', 'status', 'domain', 'logoUrl'] as const) {
        if (data[key] !== undefined && data[key] !== currentOrg[key]) {
          changes[key] = { from: currentOrg[key] ?? null, to: data[key] ?? null };
        }
      }
      if (Object.keys(changes).length > 0) {
        const action =
          data.status === 'suspended'
            ? 'org.suspended'
            : currentOrg.status === 'suspended' && data.status
              ? 'org.reactivated'
              : data.plan !== undefined && data.plan !== currentOrg.plan
                ? 'org.plan_changed'
                : 'org.updated';
        await tx.insert(systemAuditLogs).values({
          id: createId(),
          userId: session.user.id,
          action,
          resourceType: 'organization',
          resourceId: organizationId,
          organizationId,
          changes,
          ipAddress:
            request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        });
      }
      return updated;
    });

    if (!updatedOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json(updatedOrg);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (
      (error as { code?: unknown })?.code === '23505' ||
      (error instanceof Error && error.message === 'organization_slug_exists')
    ) {
      return NextResponse.json({ error: 'Organization slug already exists' }, { status: 409 });
    }

    console.error('Failed to update organization:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

// DELETE /api/admin/organizations/[organizationId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const { organizationId } = await params;

    const deleted = await db.transaction(async (tx) => {
      const [currentOrg] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
        .for('update');
      if (!currentOrg) return false;

      await tx.delete(organizations).where(eq(organizations.id, organizationId));
      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: 'org.deleted',
        resourceType: 'organization',
        resourceId: organizationId,
        organizationId,
        metadata: {
          name: currentOrg.name,
          slug: currentOrg.slug,
          plan: currentOrg.plan,
          status: currentOrg.status,
        },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return true;
    });

    if (!deleted) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete organization:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
