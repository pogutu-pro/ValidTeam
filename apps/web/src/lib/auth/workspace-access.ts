import { auth } from '@/auth';
import { db, organizationMembers, organizations, users } from '@tasknebula/db';
import { and, eq, ne } from 'drizzle-orm';

export type WorkspaceAccessContext = {
  hasAccess: boolean;
  defaultOrganizationId: string | null;
};

export async function getUserWorkspaceAccessContext(
  userId: string
): Promise<WorkspaceAccessContext> {
  const [actor] = await db
    .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (actor?.status !== 'active') {
    return { hasAccess: false, defaultOrganizationId: null };
  }

  const [membership] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, 'active'),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(1);

  return {
    hasAccess: Boolean(actor.isSuperAdmin || membership),
    defaultOrganizationId: membership?.organizationId ?? null,
  };
}

export async function userHasWorkspaceAccess(userId: string): Promise<boolean> {
  return (await getUserWorkspaceAccessContext(userId)).hasAccess;
}

export async function currentUserHasWorkspaceAccess(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) {
    return false;
  }

  return userHasWorkspaceAccess(session.user.id);
}

export async function currentUserWorkspaceAccessContext(): Promise<WorkspaceAccessContext> {
  const session = await auth();
  if (!session?.user?.id) {
    return { hasAccess: false, defaultOrganizationId: null };
  }

  return getUserWorkspaceAccessContext(session.user.id);
}
