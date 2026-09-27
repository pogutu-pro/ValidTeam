/** @jest-environment node */

jest.mock('@tasknebula/db', () => ({
  db: {},
  organizationMembers: {},
  projectMembers: {},
  projects: {},
  users: {},
}));

import { resolveProjectAgentAccess } from '../access';

const membership = {
  role: 'product_owner',
  canBrowseProject: 'false',
  canAdministerProject: 'false',
  canManageSprints: 'false',
  canManageWorkflow: 'false',
};

describe('project agent access resolver', () => {
  it('rejects a stale project membership without active organization membership', () => {
    expect(
      resolveProjectAgentAccess({
        isSuperAdmin: false,
        orgRole: null,
        projectMembership: { ...membership, canBrowseProject: 'true' },
      })
    ).toEqual({ canView: false, canManage: false });
  });

  it('honors explicit project permission false without role-name fallback', () => {
    expect(
      resolveProjectAgentAccess({
        isSuperAdmin: false,
        orgRole: 'member',
        projectMembership: membership,
      })
    ).toEqual({ canView: false, canManage: false });
  });

  it('allows explicit scoped permissions and organization admins', () => {
    expect(
      resolveProjectAgentAccess({
        isSuperAdmin: false,
        orgRole: 'member',
        projectMembership: {
          ...membership,
          canBrowseProject: 'true',
          canManageSprints: 'true',
        },
      })
    ).toEqual({ canView: true, canManage: true });
    expect(
      resolveProjectAgentAccess({ isSuperAdmin: false, orgRole: 'admin', projectMembership: null })
    ).toEqual({ canView: true, canManage: true });
  });
});
