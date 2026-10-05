/**
 * Super Admin API - Users Management
 * GET /api/admin/users - List all users
 * POST /api/admin/users - Create new user
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  auditLogs,
  db,
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  systemAuditLogs,
  users,
} from '@validteam/db';
import { eq, desc, count, ilike, or, and, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(255),
  isSuperAdmin: z.boolean().optional().default(false),
});

const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(255).optional(),
  status: z.enum(['active', 'inactive', 'invited']).optional(),
});

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = listUsersSchema.safeParse({
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
      search: searchParams.get('search') || undefined,
      status: searchParams.get('status') || undefined,
    });
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: query.error.errors },
        { status: 400 }
      );
    }
    const { page, limit, search, status } = query.data;

    const conditions = [];
    if (status) {
      conditions.push(eq(users.status, status));
    }
    if (search) {
      conditions.push(or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))!);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get users
    const allUsers = whereClause
      ? await db
          .select()
          .from(users)
          .where(whereClause)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset((page - 1) * limit)
      : await db
          .select()
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset((page - 1) * limit);

    // Batch fetch organization memberships for all users in a single query
    const userIds = allUsers.map((u) => u.id);
    const membershipsByUser = new Map<
      string,
      Array<{ organizationId: string; organizationName: string; role: string }>
    >();
    const projectMembershipsByUser = new Map<
      string,
      Array<{
        projectId: string;
        projectKey: string;
        projectName: string;
        organizationId: string;
        organizationName: string | null;
        role: string;
      }>
    >();
    const lastActivityByUser = new Map<
      string,
      {
        action: string;
        resourceType: string;
        resourceId: string | null;
        projectId: string | null;
        createdAt: Date;
        scope: 'system' | 'workspace';
      }
    >();

    const rememberLastActivity = (row: {
      userId: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      projectId: string | null;
      createdAt: Date;
      scope: 'system' | 'workspace';
    }) => {
      const existing = lastActivityByUser.get(row.userId);
      if (!existing || row.createdAt > existing.createdAt) {
        lastActivityByUser.set(row.userId, row);
      }
    };

    if (userIds.length > 0) {
      const allMemberships = await db
        .select({
          userId: organizationMembers.userId,
          organizationId: organizationMembers.organizationId,
          organizationName: organizations.name,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(inArray(organizationMembers.userId, userIds));

      for (const row of allMemberships) {
        const list = membershipsByUser.get(row.userId) || [];
        list.push({
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          role: row.role,
        });
        membershipsByUser.set(row.userId, list);
      }

      const allProjectMemberships = await db
        .select({
          userId: projectMembers.userId,
          projectId: projects.id,
          projectKey: projects.key,
          projectName: projects.name,
          organizationId: projects.organizationId,
          organizationName: organizations.name,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .leftJoin(organizations, eq(projects.organizationId, organizations.id))
        .where(inArray(projectMembers.userId, userIds));

      for (const row of allProjectMemberships) {
        const list = projectMembershipsByUser.get(row.userId) || [];
        list.push({
          projectId: row.projectId,
          projectKey: row.projectKey,
          projectName: row.projectName,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          role: row.role,
        });
        projectMembershipsByUser.set(row.userId, list);
      }

      const recentWorkspaceActivity = await db
        .select({
          userId: auditLogs.userId,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          projectId: auditLogs.projectId,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(inArray(auditLogs.userId, userIds))
        .orderBy(desc(auditLogs.createdAt))
        .limit(userIds.length * 10);

      for (const row of recentWorkspaceActivity) {
        rememberLastActivity({ ...row, scope: 'workspace' });
      }

      const recentSystemActivity = await db
        .select({
          userId: systemAuditLogs.userId,
          action: systemAuditLogs.action,
          resourceType: systemAuditLogs.resourceType,
          resourceId: systemAuditLogs.resourceId,
          projectId: systemAuditLogs.organizationId,
          createdAt: systemAuditLogs.createdAt,
        })
        .from(systemAuditLogs)
        .where(inArray(systemAuditLogs.userId, userIds))
        .orderBy(desc(systemAuditLogs.createdAt))
        .limit(userIds.length * 10);

      for (const row of recentSystemActivity) {
        rememberLastActivity({ ...row, projectId: null, scope: 'system' });
      }
    }

    const usersWithOrgs = allUsers.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin,
      superAdminGrantedAt: user.superAdminGrantedAt,
      emailVerified: user.emailVerified,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
      organizations: membershipsByUser.get(user.id) || [],
      projectMemberships: projectMembershipsByUser.get(user.id) || [],
      lastActivity: lastActivityByUser.get(user.id) || null,
    }));

    // Get total count
    const totalQuery = db.select({ count: count() }).from(users);
    const [totalCount] = whereClause ? await totalQuery.where(whereClause) : await totalQuery;

    return NextResponse.json({
      users: usersWithOrgs,
      pagination: {
        page,
        limit,
        total: Number(totalCount?.count || 0),
        totalPages: Math.ceil(Number(totalCount?.count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, email, password, isSuperAdmin: makeSuperAdmin } = createUserSchema.parse(body);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          id: createId(),
          name,
          email,
          password: passwordHash,
          status: 'active',
          isSuperAdmin: makeSuperAdmin,
          superAdminGrantedAt: makeSuperAdmin ? new Date() : null,
          superAdminGrantedBy: makeSuperAdmin ? session.user.id : null,
          settings: {},
        })
        .returning();
      if (!created) throw new Error('admin_user_create_failed');

      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: makeSuperAdmin ? 'user.created_super_admin' : 'user.created',
        resourceType: 'user',
        resourceId: created.id,
        changes: {
          status: { from: null, to: created.status },
          isSuperAdmin: { from: null, to: created.isSuperAdmin },
        },
        metadata: {
          email: created.email,
          name: created.name,
        },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return created;
    });

    return NextResponse.json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        status: newUser.status,
        isSuperAdmin: newUser.isSuperAdmin,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
    }

    console.error('Failed to create user:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
