import { db, eq, hasPermission as roleHasPermission, users } from '@validteam/db';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';

/**
 * Shared helper: is the calling user allowed to administer templates in the
 * given organization? Uses the org:settings permission. Any org member may
 * list + use.
 */
export async function getTemplateAuthz(userId: string, organizationId: string | null) {
  if (!organizationId) {
    const [user] = await db
      .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const isSuperAdmin = user?.status === 'active' && user.isSuperAdmin === true;
    return { isSuperAdmin, isMember: isSuperAdmin, canAdminister: isSuperAdmin };
  }

  const access = await resolveOrganizationAccess(userId, organizationId);
  const canAdminister =
    access.allowed && roleHasPermission(access.role || '', 'org:settings', access.isSuperAdmin);
  return {
    isSuperAdmin: access.isSuperAdmin,
    isMember: access.allowed,
    canAdminister,
  };
}
