export type AdminUserStatus = 'active' | 'inactive' | 'invited';

export type AdminUserUpdateInvariant =
  | 'admin_self_super_admin_revocation_forbidden'
  | 'admin_self_deactivation_forbidden'
  | 'admin_last_active_super_admin_required';

export type AdminUserDeleteInvariant =
  | 'admin_self_deletion_forbidden'
  | 'admin_last_active_super_admin_required';

export type AdminUserGovernanceError = AdminUserUpdateInvariant | AdminUserDeleteInvariant;

const ADMIN_USER_GOVERNANCE_ERRORS = new Set<AdminUserGovernanceError>([
  'admin_self_super_admin_revocation_forbidden',
  'admin_self_deactivation_forbidden',
  'admin_last_active_super_admin_required',
  'admin_self_deletion_forbidden',
]);

export function getAdminUserGovernanceMessageKey(
  value: unknown
): `userGovernance.${AdminUserGovernanceError}` | null {
  return typeof value === 'string' &&
    ADMIN_USER_GOVERNANCE_ERRORS.has(value as AdminUserGovernanceError)
    ? `userGovernance.${value as AdminUserGovernanceError}`
    : null;
}

type AdminUserAuditChanges = {
  isSuperAdmin?: { from: unknown; to: unknown };
  status?: { from: unknown; to: unknown };
};

export function getAdminUserUpdateAuditAction(
  changes: AdminUserAuditChanges
): 'user.promoted_to_super_admin' | 'user.revoked_super_admin' | 'user.updated' {
  if (changes.isSuperAdmin?.to === true) return 'user.promoted_to_super_admin';
  if (changes.isSuperAdmin?.to === false) return 'user.revoked_super_admin';
  return 'user.updated';
}

export function getAdminUserUpdateInvariant(input: {
  actorId: string;
  targetId: string;
  current: { isSuperAdmin: boolean; status: AdminUserStatus };
  update: { isSuperAdmin?: boolean; status?: AdminUserStatus };
  remainingActiveSuperAdmins: number;
}): AdminUserUpdateInvariant | null {
  const { actorId, targetId, current, update, remainingActiveSuperAdmins } = input;

  if (actorId === targetId && update.isSuperAdmin === false) {
    return 'admin_self_super_admin_revocation_forbidden';
  }

  if (actorId === targetId && update.status !== undefined && update.status !== 'active') {
    return 'admin_self_deactivation_forbidden';
  }

  const removesActiveSuperAdmin =
    current.isSuperAdmin &&
    current.status === 'active' &&
    (update.isSuperAdmin === false || (update.status !== undefined && update.status !== 'active'));

  if (removesActiveSuperAdmin && remainingActiveSuperAdmins === 0) {
    return 'admin_last_active_super_admin_required';
  }

  return null;
}

export function getAdminUserDeleteInvariant(input: {
  actorId: string;
  targetId: string;
  current: { isSuperAdmin: boolean; status: AdminUserStatus };
  remainingActiveSuperAdmins: number;
}): AdminUserDeleteInvariant | null {
  const { actorId, targetId, current, remainingActiveSuperAdmins } = input;

  if (actorId === targetId) return 'admin_self_deletion_forbidden';

  if (current.isSuperAdmin && current.status === 'active' && remainingActiveSuperAdmins === 0) {
    return 'admin_last_active_super_admin_required';
  }

  return null;
}
