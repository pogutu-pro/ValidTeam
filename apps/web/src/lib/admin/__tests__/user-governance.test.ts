import {
  getAdminUserUpdateAuditAction,
  getAdminUserGovernanceMessageKey,
  getAdminUserDeleteInvariant,
  getAdminUserUpdateInvariant,
} from '../user-governance';

const activeAdmin = { isSuperAdmin: true, status: 'active' as const };

describe('admin user governance invariants', () => {
  it('maps only known server invariants to localized UI keys', () => {
    expect(getAdminUserGovernanceMessageKey('admin_self_deactivation_forbidden')).toBe(
      'userGovernance.admin_self_deactivation_forbidden'
    );
    expect(getAdminUserGovernanceMessageKey('arbitrary backend error')).toBeNull();
  });

  it('classifies audit actions from actual changes instead of echoed form values', () => {
    expect(getAdminUserUpdateAuditAction({ status: { from: 'active', to: 'inactive' } })).toBe(
      'user.updated'
    );
    expect(getAdminUserUpdateAuditAction({ isSuperAdmin: { from: false, to: true } })).toBe(
      'user.promoted_to_super_admin'
    );
    expect(getAdminUserUpdateAuditAction({ isSuperAdmin: { from: true, to: false } })).toBe(
      'user.revoked_super_admin'
    );
  });

  it('prevents an administrator from revoking their own platform access', () => {
    expect(
      getAdminUserUpdateInvariant({
        actorId: 'admin-1',
        targetId: 'admin-1',
        current: activeAdmin,
        update: { isSuperAdmin: false },
        remainingActiveSuperAdmins: 2,
      })
    ).toBe('admin_self_super_admin_revocation_forbidden');
  });

  it.each(['inactive', 'invited'] as const)(
    'prevents an administrator from changing their own status to %s',
    (status) => {
      expect(
        getAdminUserUpdateInvariant({
          actorId: 'admin-1',
          targetId: 'admin-1',
          current: activeAdmin,
          update: { status },
          remainingActiveSuperAdmins: 2,
        })
      ).toBe('admin_self_deactivation_forbidden');
    }
  );

  it('preserves the last active super administrator', () => {
    expect(
      getAdminUserUpdateInvariant({
        actorId: 'admin-1',
        targetId: 'admin-2',
        current: activeAdmin,
        update: { status: 'inactive' },
        remainingActiveSuperAdmins: 0,
      })
    ).toBe('admin_last_active_super_admin_required');
  });

  it('allows lockout-affecting changes when another active super administrator remains', () => {
    expect(
      getAdminUserUpdateInvariant({
        actorId: 'admin-1',
        targetId: 'admin-2',
        current: activeAdmin,
        update: { isSuperAdmin: false, status: 'inactive' },
        remainingActiveSuperAdmins: 1,
      })
    ).toBeNull();
  });

  it('does not treat ordinary user updates as a platform recovery risk', () => {
    expect(
      getAdminUserUpdateInvariant({
        actorId: 'admin-1',
        targetId: 'user-1',
        current: { isSuperAdmin: false, status: 'active' },
        update: { status: 'inactive' },
        remainingActiveSuperAdmins: 1,
      })
    ).toBeNull();
  });

  it('prevents an administrator from deleting their own account', () => {
    expect(
      getAdminUserDeleteInvariant({
        actorId: 'admin-1',
        targetId: 'admin-1',
        current: activeAdmin,
        remainingActiveSuperAdmins: 2,
      })
    ).toBe('admin_self_deletion_forbidden');
  });

  it('prevents deletion of the last active super administrator', () => {
    expect(
      getAdminUserDeleteInvariant({
        actorId: 'admin-1',
        targetId: 'admin-2',
        current: activeAdmin,
        remainingActiveSuperAdmins: 0,
      })
    ).toBe('admin_last_active_super_admin_required');
  });

  it('allows deleting an inactive former recovery account', () => {
    expect(
      getAdminUserDeleteInvariant({
        actorId: 'admin-1',
        targetId: 'admin-2',
        current: { isSuperAdmin: true, status: 'inactive' },
        remainingActiveSuperAdmins: 0,
      })
    ).toBeNull();
  });
});
