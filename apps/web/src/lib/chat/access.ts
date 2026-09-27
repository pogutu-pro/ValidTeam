import {
  ROLE_DEFAULT_PERMISSIONS,
  hasPermission as roleHasPermission,
  type ProjectRole,
} from '@tasknebula/db';

export type ChatPermissionSet = {
  canBrowseProject: boolean;
  canAdministerProject: boolean;
  canBrowseChat: boolean;
  canCreateChannels: boolean;
  canPostMessages: boolean;
  canModerateMessages: boolean;
  canStartCalls: boolean;
  canManageCalls: boolean;
};

type ChatProjectMembership = {
  role: string;
  canBrowseProject?: string | null;
  canAdministerProject?: string | null;
  canBrowseChat?: string | null;
  canCreateChannels?: string | null;
  canPostMessages?: string | null;
  canModerateMessages?: string | null;
  canStartCalls?: string | null;
  canManageCalls?: string | null;
};

function allChatPermissions(): ChatPermissionSet {
  return {
    canBrowseProject: true,
    canAdministerProject: true,
    canBrowseChat: true,
    canCreateChannels: true,
    canPostMessages: true,
    canModerateMessages: true,
    canStartCalls: true,
    canManageCalls: true,
  };
}

function noChatPermissions(): ChatPermissionSet {
  return {
    canBrowseProject: false,
    canAdministerProject: false,
    canBrowseChat: false,
    canCreateChannels: false,
    canPostMessages: false,
    canModerateMessages: false,
    canStartCalls: false,
    canManageCalls: false,
  };
}

function permissionValue(value: string | null | undefined, fallback = false) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * Resolve project-chat permissions while preserving the tenant hierarchy:
 * project membership is never an independent grant after organization
 * membership is removed. Super admins and organization project managers keep
 * their explicit recovery/management path.
 */
export function resolveProjectChatPermissions(input: {
  orgRole: string | null;
  isSuperAdmin: boolean;
  projectMembership: ChatProjectMembership | null;
}): { permissions: ChatPermissionSet; hasOrgProjectManagement: boolean } {
  const hasOrgProjectManagement = roleHasPermission(
    input.orgRole || '',
    'project:manage',
    input.isSuperAdmin
  );
  if (hasOrgProjectManagement) {
    return { permissions: allChatPermissions(), hasOrgProjectManagement };
  }

  if (!input.orgRole || !input.projectMembership) {
    return { permissions: noChatPermissions(), hasOrgProjectManagement };
  }

  const member = input.projectMembership;
  const defaults = ROLE_DEFAULT_PERMISSIONS[member.role as ProjectRole];
  return {
    hasOrgProjectManagement,
    permissions: {
      canBrowseProject: permissionValue(member.canBrowseProject, defaults?.canBrowseProject),
      canAdministerProject: permissionValue(
        member.canAdministerProject,
        defaults?.canAdministerProject
      ),
      canBrowseChat: permissionValue(member.canBrowseChat, defaults?.canBrowseChat),
      canCreateChannels: permissionValue(member.canCreateChannels, defaults?.canCreateChannels),
      canPostMessages: permissionValue(member.canPostMessages, defaults?.canPostMessages),
      canModerateMessages: permissionValue(
        member.canModerateMessages,
        defaults?.canModerateMessages
      ),
      canStartCalls: permissionValue(member.canStartCalls, defaults?.canStartCalls),
      canManageCalls: permissionValue(member.canManageCalls, defaults?.canManageCalls),
    },
  };
}
