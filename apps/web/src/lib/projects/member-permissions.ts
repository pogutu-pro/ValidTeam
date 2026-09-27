import { ROLE_DEFAULT_PERMISSIONS, type ProjectRole } from '@tasknebula/db';

const PROJECT_PERMISSION_COLUMNS = [
  'canBrowseProject',
  'canAdministerProject',
  'canBrowseDocs',
  'canCreateDocs',
  'canEditDocs',
  'canDeleteDocs',
  'canBrowseChat',
  'canCreateChannels',
  'canPostMessages',
  'canModerateMessages',
  'canStartCalls',
  'canManageCalls',
  'canManageSprints',
  'canStartSprint',
  'canCompleteSprint',
  'canDeleteSprint',
  'canCreateIssues',
  'canEditIssues',
  'canEditOwnIssues',
  'canDeleteIssues',
  'canDeleteOwnIssues',
  'canAssignIssues',
  'canAssigneeIssues',
  'canTransitionIssues',
  'canScheduleIssues',
  'canMoveIssues',
  'canLinkIssues',
  'canCloseIssues',
  'canReopenIssues',
  'canAddComments',
  'canEditOwnComments',
  'canEditAllComments',
  'canDeleteOwnComments',
  'canDeleteAllComments',
  'canCreateAttachments',
  'canDeleteOwnAttachments',
  'canDeleteAllAttachments',
  'canManageWatchers',
  'canViewWatchers',
  'canManageMembers',
  'canInviteMembers',
  'canRemoveMembers',
  'canChangeRoles',
  'canManageWorkflow',
  'canLogWork',
  'canEditOwnWorklogs',
  'canEditAllWorklogs',
  'canDeleteOwnWorklogs',
  'canDeleteAllWorklogs',
] as const;

type ProjectPermissionColumn = (typeof PROJECT_PERMISSION_COLUMNS)[number];

/**
 * Resolve a persisted granular permission without allowing a role default to
 * override an explicit denial. The fallback exists only for legacy/null rows.
 */
export function resolveProjectMemberPermission(value: unknown, fallback = false): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

export function getProjectMemberPermissionValues(role: ProjectRole) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.developer;

  return PROJECT_PERMISSION_COLUMNS.reduce(
    (acc, key) => {
      acc[key] = defaults[key] ? 'true' : 'false';
      return acc;
    },
    {} as Record<ProjectPermissionColumn, 'true' | 'false'>
  );
}
