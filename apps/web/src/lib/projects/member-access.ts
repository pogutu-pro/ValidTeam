import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

export async function canManageProjectMembers(userId: string, projectId: string): Promise<boolean> {
  const access = await resolveProjectCapabilityAccess(userId, projectId);
  return (
    access.canRead && (access.permissions.canManageMembers || access.permissions.canInviteMembers)
  );
}
