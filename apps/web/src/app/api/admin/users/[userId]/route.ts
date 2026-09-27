/**
 * Super Admin API - Single User Management
 * GET /api/admin/users/[userId] - Get user details
 * PATCH /api/admin/users/[userId] - Update user (grant/revoke super admin)
 * DELETE /api/admin/users/[userId] - Delete user
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, users, systemAuditLogs, schema } from '@tasknebula/db';
import { and, count, eq, ne, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { createId } from '@paralleldrive/cuid2';
import {
  getAdminUserUpdateAuditAction,
  getAdminUserDeleteInvariant,
  getAdminUserUpdateInvariant,
  type AdminUserStatus,
} from '@/lib/admin/user-governance';
import { shouldRotateSessionVersion } from '@/lib/auth/session-revocation';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type UserReferenceRow = {
  schemaName: string;
  tableName: string;
  columnName: string;
  isNotNull: boolean;
  deleteAction: string;
};

// GET /api/admin/users/[userId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
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

    const { userId } = await params;

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        status: users.status,
        isSuperAdmin: users.isSuperAdmin,
        superAdminGrantedAt: users.superAdminGrantedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

const updateUserSchema = z.object({
  isSuperAdmin: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'invited']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
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

    const { userId } = await params;
    const body = await request.json();
    const data = updateUserSchema.parse(body);

    const transactionResult = await db.transaction(async (tx) => {
      // Serialize super-admin governance decisions so two concurrent demotions
      // cannot both observe the other administrator and leave the installation
      // without an active recovery account.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('tasknebula.admin-user-governance'))`
      );

      const [currentUser] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!currentUser) return { kind: 'not_found' as const };

      const [remaining] = await tx
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.isSuperAdmin, true), eq(users.status, 'active'), ne(users.id, userId)));

      const invariant = getAdminUserUpdateInvariant({
        actorId: session.user.id,
        targetId: userId,
        current: {
          isSuperAdmin: currentUser.isSuperAdmin,
          status: currentUser.status as AdminUserStatus,
        },
        update: data,
        remainingActiveSuperAdmins: Number(remaining?.count ?? 0),
      });
      if (invariant) return { kind: 'invariant' as const, invariant };

      const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (data.isSuperAdmin === true && !currentUser.isSuperAdmin) {
        updateData.superAdminGrantedAt = new Date();
        updateData.superAdminGrantedBy = session.user.id;
      }
      if (data.isSuperAdmin === false && currentUser.isSuperAdmin) {
        updateData.superAdminGrantedAt = null;
        updateData.superAdminGrantedBy = null;
      }
      if (
        shouldRotateSessionVersion(
          currentUser.status as AdminUserStatus,
          data.status as AdminUserStatus | undefined
        )
      ) {
        updateData.sessionVersion = sql`${users.sessionVersion} + 1`;
      }

      const [updatedUser] = await tx
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();
      if (!updatedUser) throw new Error('Failed to update user');

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (data.isSuperAdmin !== undefined && data.isSuperAdmin !== currentUser.isSuperAdmin) {
        changes.isSuperAdmin = { from: currentUser.isSuperAdmin, to: data.isSuperAdmin };
      }
      if (data.status && data.status !== currentUser.status) {
        changes.status = { from: currentUser.status, to: data.status };
      }

      if (Object.keys(changes).length > 0) {
        await tx.insert(systemAuditLogs).values({
          id: createId(),
          userId: session.user.id,
          action: getAdminUserUpdateAuditAction(changes),
          resourceType: 'user',
          resourceId: userId,
          changes,
          ipAddress:
            request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        });
      }

      return { kind: 'updated' as const, updatedUser };
    });

    if (transactionResult.kind === 'not_found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (transactionResult.kind === 'invariant') {
      return NextResponse.json(
        { error: transactionResult.invariant, code: transactionResult.invariant },
        { status: 400 }
      );
    }

    const { updatedUser } = transactionResult;

    return NextResponse.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      image: updatedUser.image,
      status: updatedUser.status,
      isSuperAdmin: updatedUser.isSuperAdmin,
      superAdminGrantedAt: updatedUser.superAdminGrantedAt,
      createdAt: updatedUser.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
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

    const { userId } = await params;

    const transactionResult = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('tasknebula.admin-user-governance'))`
      );

      const [currentUser] = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          status: users.status,
          isSuperAdmin: users.isSuperAdmin,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!currentUser) return { kind: 'not_found' as const };

      const [remaining] = await tx
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.isSuperAdmin, true), eq(users.status, 'active'), ne(users.id, userId)));

      const invariant = getAdminUserDeleteInvariant({
        actorId: session.user.id,
        targetId: userId,
        current: {
          isSuperAdmin: currentUser.isSuperAdmin,
          status: currentUser.status as AdminUserStatus,
        },
        remainingActiveSuperAdmins: Number(remaining?.count ?? 0),
      });
      if (invariant) return { kind: 'invariant' as const, invariant };

      await detachUserReferences(tx, {
        userId,
        fallbackUserId: session.user.id,
      });

      await tx.delete(schema.users).where(eq(schema.users.id, userId));

      await tx.insert(systemAuditLogs).values({
        id: createId(),
        userId: session.user.id,
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: userId,
        changes: {
          status: { from: currentUser.status, to: null },
          isSuperAdmin: { from: currentUser.isSuperAdmin, to: null },
        },
        metadata: {
          email: currentUser.email,
          name: currentUser.name,
        },
        ipAddress:
          request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return { kind: 'deleted' as const };
    });

    if (transactionResult.kind === 'not_found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (transactionResult.kind === 'invariant') {
      return NextResponse.json(
        { error: transactionResult.invariant, code: transactionResult.invariant },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

async function detachUserReferences(
  tx: DbTransaction,
  { userId, fallbackUserId }: { userId: string; fallbackUserId: string }
) {
  const result = await tx.execute<UserReferenceRow>(sql`
    SELECT
      ns.nspname AS "schemaName",
      cls.relname AS "tableName",
      attr.attname AS "columnName",
      attr.attnotnull AS "isNotNull",
      constraint_row.confdeltype AS "deleteAction"
    FROM pg_constraint constraint_row
    JOIN pg_class cls ON cls.oid = constraint_row.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute attr
      ON attr.attrelid = constraint_row.conrelid
     AND attr.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.users'::regclass
      AND array_length(constraint_row.conkey, 1) = 1
  `);
  const references: UserReferenceRow[] = Array.isArray(result)
    ? result
    : ((result as { rows?: UserReferenceRow[] }).rows ?? []);

  for (const reference of references) {
    if (reference.deleteAction === 'c' || reference.deleteAction === 'n') {
      continue;
    }

    const qualifiedTable = sql.raw(
      `${quoteIdentifier(reference.schemaName)}.${quoteIdentifier(reference.tableName)}`
    );
    const column = sql.raw(quoteIdentifier(reference.columnName));

    if (reference.isNotNull) {
      await tx.execute(sql`
        UPDATE ${qualifiedTable}
        SET ${column} = ${fallbackUserId}
        WHERE ${column} = ${userId}
      `);
    } else {
      await tx.execute(sql`
        UPDATE ${qualifiedTable}
        SET ${column} = NULL
        WHERE ${column} = ${userId}
      `);
    }
  }

  await tx.delete(schema.organizationMembers).where(eq(schema.organizationMembers.userId, userId));

  await tx.delete(schema.teamMembers).where(eq(schema.teamMembers.userId, userId));

  await tx
    .update(schema.teams)
    .set({ leadId: null, updatedAt: new Date() })
    .where(eq(schema.teams.leadId, userId));

  await tx
    .update(schema.systemSettings)
    .set({ updatedBy: null, updatedAt: new Date() })
    .where(eq(schema.systemSettings.updatedBy, userId));

  await tx
    .update(schema.featureFlags)
    .set({ createdBy: null, updatedAt: new Date() })
    .where(eq(schema.featureFlags.createdBy, userId));

  await tx
    .update(schema.featureFlags)
    .set({ updatedBy: null, updatedAt: new Date() })
    .where(eq(schema.featureFlags.updatedBy, userId));

  await tx
    .update(schema.organizationInvitations)
    .set({ invitedBy: null, updatedAt: new Date() })
    .where(eq(schema.organizationInvitations.invitedBy, userId));

  await tx
    .update(schema.users)
    .set({ superAdminGrantedBy: null, updatedAt: new Date() })
    .where(eq(schema.users.superAdminGrantedBy, userId));
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
