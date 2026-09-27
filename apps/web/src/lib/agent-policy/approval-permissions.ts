import { hasPermission } from '@/lib/auth/permissions';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

const PROJECT_MAINTAINER_ROLES = new Set(['product_owner', 'scrum_master', 'tech_lead']);

export async function canManageAgentApprovals(params: {
  userId: string;
  workspaceId: string;
  projectId?: string | null;
}) {
  if (await hasPermission(params.workspaceId, 'org:manage')) return true;

  if (!params.projectId) return false;

  const access = await resolveProjectCapabilityAccess(params.userId, params.projectId);
  return (
    access.canRead &&
    access.project?.organizationId === params.workspaceId &&
    (access.canManage || PROJECT_MAINTAINER_ROLES.has(access.role ?? ''))
  );
}
