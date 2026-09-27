import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

function toBool(value: string | null | undefined) {
  return value === 'true';
}

export function resolveProjectAgentAccess(input: {
  isSuperAdmin: boolean;
  orgRole: 'owner' | 'admin' | 'member' | 'viewer' | 'guest' | null;
  projectMembership: {
    role: string;
    canBrowseProject: string;
    canAdministerProject: string;
    canManageSprints: string;
    canManageWorkflow: string;
  } | null;
}) {
  if (input.isSuperAdmin) return { canView: true, canManage: true };
  // A project-membership row is never an independent tenant grant. It becomes
  // effective only while the user retains active organization membership.
  if (!input.orgRole) return { canView: false, canManage: false };
  if (input.orgRole === 'owner' || input.orgRole === 'admin') {
    return { canView: true, canManage: true };
  }
  if (!input.projectMembership) return { canView: false, canManage: false };
  return {
    canView: toBool(input.projectMembership.canBrowseProject),
    canManage:
      toBool(input.projectMembership.canAdministerProject) ||
      toBool(input.projectMembership.canManageSprints) ||
      toBool(input.projectMembership.canManageWorkflow),
  };
}

export async function getOrgAgentAccess(userId: string, organizationId: string) {
  const access = await resolveOrganizationAccess(userId, organizationId);
  const orgRole = access.role;
  const isSuperAdmin = access.isSuperAdmin;
  const canView = access.allowed;
  const canManage = isSuperAdmin || orgRole === 'owner' || orgRole === 'admin';

  return {
    canView,
    canManage,
    orgRole,
    isSuperAdmin,
  };
}

export async function getProjectAgentAccess(userId: string, projectId: string) {
  const access = await resolveProjectCapabilityAccess(userId, projectId);
  const project = access.project;

  if (!project) {
    return {
      canView: false,
      canManage: false,
      isSuperAdmin: access.isSuperAdmin,
      orgRole: null,
      projectRole: null,
      project: null,
    };
  }

  const orgAccess = await resolveOrganizationAccess(userId, project.organizationId);
  const canManage =
    access.canManage || access.permissions.canManageSprints || access.permissions.canManageWorkflow;

  return {
    canView: access.canRead,
    canManage,
    isSuperAdmin: access.isSuperAdmin,
    orgRole: access.isSuperAdmin ? ('owner' as const) : orgAccess.role,
    projectRole: access.role,
    project,
  };
}
