/**
 * Permission utilities for Next.js app
 * Server-side permission checking
 */

import { auth } from '@/auth';
import {
  db,
  organizationMembers,
  organizations,
  users,
  Permission,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  hasAllPermissions as checkAllPermissions,
  getRolePermissions,
} from '@tasknebula/db';
import { eq, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { listActiveOrganizationMemberships } from '@/lib/auth/access-control';

/**
 * Get current user's organization role and super admin status
 */
export async function getUserRole(organizationId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  // Get user's super admin status
  const [user] = await db
    .select({
      status: users.status,
      isSuperAdmin: users.isSuperAdmin,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (user?.status !== 'active') {
    return null;
  }

  // Get user's organization role
  const [member] = await db
    .select({
      role: organizationMembers.role,
      status: organizationMembers.status,
      organizationStatus: organizations.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, session.user.id),
        eq(organizationMembers.organizationId, organizationId)
      )
    )
    .limit(1);

  return {
    role:
      member?.status === 'active' && member.organizationStatus !== 'suspended' ? member.role : null,
    isSuperAdmin: user.isSuperAdmin,
  };
}

/**
 * Check if current user has a specific permission in an organization
 */
export async function hasPermission(
  organizationId: string,
  permission: Permission
): Promise<boolean> {
  const userRole = await getUserRole(organizationId);
  if (!userRole) {
    return false;
  }

  return checkPermission(userRole.role || '', permission, userRole.isSuperAdmin);
}

/**
 * Check if current user has any of the specified permissions
 */
export async function hasAnyPermission(
  organizationId: string,
  permissions: Permission[]
): Promise<boolean> {
  const userRole = await getUserRole(organizationId);
  if (!userRole) {
    return false;
  }

  return checkAnyPermission(userRole.role || '', permissions, userRole.isSuperAdmin);
}

/**
 * Check if current user has all of the specified permissions
 */
export async function hasAllPermissions(
  organizationId: string,
  permissions: Permission[]
): Promise<boolean> {
  const userRole = await getUserRole(organizationId);
  if (!userRole) {
    return false;
  }

  return checkAllPermissions(userRole.role || '', permissions, userRole.isSuperAdmin);
}

/**
 * Check if current user is a super admin
 */
export async function isSuperAdmin(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) {
    return false;
  }

  const [user] = await db
    .select({
      isSuperAdmin: users.isSuperAdmin,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return user?.status === 'active' && user.isSuperAdmin;
}

/**
 * Require super admin access - throws error if not super admin
 */
export async function requireSuperAdmin() {
  const isAdmin = await isSuperAdmin();
  if (!isAdmin) {
    throw new Error('Super admin access required');
  }
}

/**
 * Require specific permission in a server component — redirects to
 * `/dashboard?error=insufficient-permission` if the current user does not
 * have the given permission in the organization.
 *
 * Uses Next.js `redirect` (which throws), so callers do not need to handle
 * the failure case — execution will not continue past this call on denial.
 */
export async function requirePermission(
  organizationId: string,
  permission: Permission
): Promise<void> {
  const hasAccess = await hasPermission(organizationId, permission);
  if (!hasAccess) {
    redirect('/dashboard?error=insufficient-permission');
  }
}

/**
 * Return the caller's usable organizations for a permission in deterministic
 * membership order. Suspended organizations, inactive memberships and an
 * inactive actor are filtered by the canonical runtime access resolver.
 *
 * This is the page-level counterpart to `hasPermission`: settings surfaces
 * should not select an unusable "first membership" and accidentally hide a
 * later workspace the user can administer.
 */
export async function getPermittedOrganizationIds(
  userId: string,
  permission: Permission
): Promise<string[]> {
  const [[actor], memberships] = await Promise.all([
    db
      .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    listActiveOrganizationMemberships(userId),
  ]);

  if (actor?.status !== 'active') return [];

  return memberships
    .filter((membership) => checkPermission(membership.role || '', permission, actor.isSuperAdmin))
    .map((membership) => membership.organizationId);
}

/**
 * Get all permissions for current user in an organization
 */
export async function getUserPermissions(organizationId: string): Promise<Permission[]> {
  const userRole = await getUserRole(organizationId);
  if (!userRole) {
    return [];
  }

  return getRolePermissions(userRole.role || '', userRole.isSuperAdmin);
}
