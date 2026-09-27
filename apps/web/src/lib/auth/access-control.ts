import {
  db,
  issues,
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  users,
  ROLE_DEFAULT_PERMISSIONS,
  hasPermission as roleHasPermission,
  type ProjectRole,
} from '@tasknebula/db';
import { and, asc, eq, ne } from 'drizzle-orm';

/** Resolve a nullable per-member override without letting explicit denials fall through. */
export function resolvePermission(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

async function getActiveActor(userId: string) {
  const [user] = await db
    .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user?.status === 'active' ? user : null;
}

async function getActiveOrganizationMembership(userId: string, organizationId: string) {
  const [member] = await db
    .select({ id: organizationMembers.id, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'active'),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(1);

  return member ?? null;
}

export type ActiveOrganizationMembership = {
  id: string;
  organizationId: string;
  role: string;
};

/** Return only memberships that are usable at runtime. */
export async function listActiveOrganizationMemberships(
  userId: string
): Promise<ActiveOrganizationMembership[]> {
  const actor = await getActiveActor(userId);
  if (!actor) return [];

  return db
    .select({
      id: organizationMembers.id,
      organizationId: organizationMembers.organizationId,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, 'active'),
        ne(organizations.status, 'suspended')
      )
    )
    .orderBy(asc(organizationMembers.createdAt), asc(organizationMembers.id));
}

/**
 * Resolve one workspace boundary for request-time authorization. Platform
 * super administrators retain recovery access to existing suspended
 * workspaces; ordinary memberships do not.
 */
export async function resolveOrganizationAccess(
  userId: string,
  organizationId: string,
  options?: { allowSuperAdmin?: boolean }
): Promise<{
  allowed: boolean;
  isSuperAdmin: boolean;
  role: string | null;
  membershipId: string | null;
}> {
  const [actor, organization] = await Promise.all([
    getActiveActor(userId),
    db
      .select({ id: organizations.id, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const isSuperAdmin = Boolean(actor?.isSuperAdmin);
  if (!actor || !organization) {
    return { allowed: false, isSuperAdmin, role: null, membershipId: null };
  }
  if (isSuperAdmin && options?.allowSuperAdmin !== false) {
    return { allowed: true, isSuperAdmin: true, role: null, membershipId: null };
  }
  if (organization.status === 'suspended') {
    return { allowed: false, isSuperAdmin, role: null, membershipId: null };
  }

  const membership = await getActiveOrganizationMembership(userId, organizationId);
  return {
    allowed: Boolean(membership),
    isSuperAdmin,
    role: membership?.role ?? null,
    membershipId: membership?.id ?? null,
  };
}

export async function isActiveOrganizationMember(
  userId: string,
  organizationId: string
): Promise<boolean> {
  return (await resolveOrganizationAccess(userId, organizationId)).allowed;
}

async function getProjectMembership(userId: string, projectId: string) {
  const [member] = await db
    .select({
      role: projectMembers.role,
      canBrowseProject: projectMembers.canBrowseProject,
      canAdministerProject: projectMembers.canAdministerProject,
      canAddComments: projectMembers.canAddComments,
      canEditIssues: projectMembers.canEditIssues,
    })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
    .limit(1);

  return member ?? null;
}

export async function canReadProject(
  userId: string,
  project: typeof projects.$inferSelect,
  options?: { allowSuperAdmin?: boolean }
): Promise<boolean> {
  const user = await getActiveActor(userId);
  if (!user) return false;
  if (user?.isSuperAdmin && options?.allowSuperAdmin !== false) return true;

  const orgMember = await getActiveOrganizationMembership(userId, project.organizationId);

  if (roleHasPermission(orgMember?.role || '', 'project:manage')) {
    return true;
  }
  // Project membership is subordinate to organization membership. A stale
  // project_members row must not preserve access after workspace removal.
  if (!orgMember) return false;

  const projectMember = await getProjectMembership(userId, project.id);
  if (!projectMember) return false;

  const roleDefaults =
    ROLE_DEFAULT_PERMISSIONS[projectMember.role as ProjectRole] || ROLE_DEFAULT_PERMISSIONS.viewer;
  return resolvePermission(projectMember.canBrowseProject, roleDefaults.canBrowseProject);
}

export async function canManageProject(
  userId: string,
  project: typeof projects.$inferSelect
): Promise<boolean> {
  const user = await getActiveActor(userId);
  if (!user) return false;
  if (user?.isSuperAdmin) return true;

  const orgMember = await getActiveOrganizationMembership(userId, project.organizationId);

  if (roleHasPermission(orgMember?.role || '', 'project:manage')) {
    return true;
  }

  // Project membership is subordinate to organization membership. A stale
  // project_members row must not preserve management access after workspace
  // removal or while the organization is suspended.
  if (!orgMember) return false;

  const projectMember = await getProjectMembership(userId, project.id);
  if (!projectMember) return false;

  const roleDefaults =
    ROLE_DEFAULT_PERMISSIONS[projectMember.role as ProjectRole] || ROLE_DEFAULT_PERMISSIONS.viewer;
  return resolvePermission(projectMember.canAdministerProject, roleDefaults.canAdministerProject);
}

export async function canReadIssue(
  userId: string,
  issueId: string
): Promise<{
  allowed: boolean;
  issue: typeof issues.$inferSelect | null;
}> {
  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);

  if (!issue) return { allowed: false, issue: null };

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, issue.projectId))
    .limit(1);

  if (!project) return { allowed: false, issue };
  return { allowed: await canReadProject(userId, project), issue };
}

export async function canCommentOnIssue(
  userId: string,
  issueId: string
): Promise<{
  allowed: boolean;
  issue: typeof issues.$inferSelect | null;
}> {
  const result = await canReadIssue(userId, issueId);
  if (!result.allowed || !result.issue) return result;

  const projectMember = await getProjectMembership(userId, result.issue.projectId);
  if (!projectMember) return result;

  const roleDefaults =
    ROLE_DEFAULT_PERMISSIONS[projectMember.role as ProjectRole] || ROLE_DEFAULT_PERMISSIONS.viewer;
  return {
    issue: result.issue,
    allowed: resolvePermission(projectMember.canAddComments, roleDefaults.canAddComments),
  };
}

export async function canEditIssue(
  userId: string,
  issueId: string
): Promise<{
  allowed: boolean;
  issue: typeof issues.$inferSelect | null;
}> {
  const result = await canReadIssue(userId, issueId);
  if (!result.allowed || !result.issue) return result;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, result.issue.projectId))
    .limit(1);
  if (!project) return { allowed: false, issue: result.issue };
  if (await canManageProject(userId, project)) return result;

  const projectMember = await getProjectMembership(userId, result.issue.projectId);
  if (!projectMember) return { allowed: false, issue: result.issue };

  const roleDefaults =
    ROLE_DEFAULT_PERMISSIONS[projectMember.role as ProjectRole] || ROLE_DEFAULT_PERMISSIONS.viewer;
  return {
    issue: result.issue,
    allowed: resolvePermission(projectMember.canEditIssues, roleDefaults.canEditIssues),
  };
}
