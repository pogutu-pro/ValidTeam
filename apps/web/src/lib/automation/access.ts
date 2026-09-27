import {
  db,
  automationRules,
  hasPermission as roleHasPermission,
  type Permission,
} from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import {
  canManageProject,
  canReadProject,
  resolveOrganizationAccess,
} from '@/lib/auth/access-control';
import { resolveProjectByIdOrKey } from '@/lib/projects/server';

type AutomationRuleAccess = Pick<
  typeof automationRules.$inferSelect,
  'id' | 'organizationId' | 'projectId'
>;

export type AutomationAccessResult =
  | {
      status: 'ok';
      organizationId: string;
      projectId: string | null;
      rule?: AutomationRuleAccess;
    }
  | { status: 'not-found' | 'forbidden' };

async function userHasOrganizationPermission(
  userId: string,
  organizationId: string,
  permission: Permission
): Promise<boolean> {
  const access = await resolveOrganizationAccess(userId, organizationId);
  return (
    access.allowed && roleHasPermission(access.role || '', permission, access.isSuperAdmin === true)
  );
}

export async function authorizeAutomationScope(
  userId: string,
  organizationId: string,
  projectIdOrKey?: string | null
): Promise<AutomationAccessResult> {
  if (projectIdOrKey) {
    const project = await resolveProjectByIdOrKey(projectIdOrKey, userId);
    if (!project || project.organizationId !== organizationId) {
      return { status: 'not-found' };
    }

    if (!(await canReadProject(userId, project))) {
      return { status: 'not-found' };
    }

    if (!(await canManageProject(userId, project))) {
      return { status: 'forbidden' };
    }

    return {
      status: 'ok',
      organizationId,
      projectId: project.id,
    };
  }

  if (!(await userHasOrganizationPermission(userId, organizationId, 'org:settings'))) {
    const access = await resolveOrganizationAccess(userId, organizationId);
    return { status: access.allowed ? 'forbidden' : 'not-found' };
  }

  return {
    status: 'ok',
    organizationId,
    projectId: null,
  };
}

export async function authorizeAutomationRule(
  userId: string,
  ruleId: string
): Promise<AutomationAccessResult> {
  const [rule] = await db
    .select({
      id: automationRules.id,
      organizationId: automationRules.organizationId,
      projectId: automationRules.projectId,
    })
    .from(automationRules)
    .where(eq(automationRules.id, ruleId))
    .limit(1);

  if (!rule) {
    return { status: 'not-found' };
  }

  const access = await authorizeAutomationScope(userId, rule.organizationId, rule.projectId);
  if (access.status !== 'ok') {
    return access;
  }

  return {
    ...access,
    rule,
  };
}
