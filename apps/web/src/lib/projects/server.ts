import { db, organizationMembers, organizations, projects, users } from '@validteam/db';
import { and, eq, ne } from 'drizzle-orm';

/**
 * Resolve a project by its CUID2 id or by its project key.
 *
 * Project keys are only unique per organization, so the key-lookup branch
 * MUST be scoped to organizations the calling user belongs to — an unscoped
 * key lookup resolves projects across tenants. Pass `userId` whenever the
 * lookup happens on behalf of a request. Super admins resolve across all
 * organizations.
 *
 * When `userId` is omitted (trusted internal callers only), the legacy
 * unscoped key lookup is preserved; callers are then responsible for
 * authorizing access to the resolved project's organization themselves.
 */
export async function resolveProjectByIdOrKey(projectIdOrKey: string, userId?: string) {
  const key = projectIdOrKey.toUpperCase();

  // Trusted internal callers retain the legacy unscoped resolver.
  if (userId === undefined) {
    let [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectIdOrKey))
      .limit(1);
    if (!project) {
      [project] = await db.select().from(projects).where(eq(projects.key, key)).limit(1);
    }
    return project ?? null;
  }

  const [actor] = await db
    .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (actor?.status !== 'active') return null;

  if (actor.isSuperAdmin) {
    let [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectIdOrKey))
      .limit(1);
    if (!project) {
      [project] = await db.select().from(projects).where(eq(projects.key, key)).limit(1);
    }
    return project ?? null;
  }

  const membershipScope = and(
    eq(organizationMembers.organizationId, projects.organizationId),
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.status, 'active')
  );
  let [match] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(organizationMembers, membershipScope)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(and(eq(projects.id, projectIdOrKey), ne(organizations.status, 'suspended')))
    .limit(1);
  if (!match) {
    [match] = await db
      .select({ project: projects })
      .from(projects)
      .innerJoin(organizationMembers, membershipScope)
      .innerJoin(organizations, eq(organizations.id, projects.organizationId))
      .where(and(eq(projects.key, key), ne(organizations.status, 'suspended')))
      .limit(1);
  }
  return match?.project ?? null;
}

/**
 * Resolve a project id from an id-or-key, scoped the same way as
 * {@link resolveProjectByIdOrKey}.
 */
export async function resolveProjectId(
  projectIdOrKey: string,
  userId?: string
): Promise<string | null> {
  const project = await resolveProjectByIdOrKey(projectIdOrKey, userId);
  return project?.id ?? null;
}
