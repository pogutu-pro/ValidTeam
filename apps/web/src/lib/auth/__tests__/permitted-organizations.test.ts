/**
 * @jest-environment node
 */

const selectMock = jest.fn();
const listActiveOrganizationMembershipsMock = jest.fn();

jest.mock('@/auth', () => ({ auth: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/auth/access-control', () => ({
  listActiveOrganizationMemberships: (...args: unknown[]) =>
    listActiveOrganizationMembershipsMock(...args),
}));
jest.mock('@validteam/db', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
  users: {
    id: 'users.id',
    status: 'users.status',
    isSuperAdmin: 'users.isSuperAdmin',
  },
  organizations: { id: 'organizations.id', status: 'organizations.status' },
  organizationMembers: {
    userId: 'organizationMembers.userId',
    organizationId: 'organizationMembers.organizationId',
    role: 'organizationMembers.role',
    status: 'organizationMembers.status',
  },
  hasPermission: (role: string, permission: string, isSuperAdmin: boolean) =>
    isSuperAdmin ||
    (permission === 'org:settings' && ['owner', 'admin'].includes(role)) ||
    (permission === 'member:view' && ['owner', 'admin', 'member'].includes(role)),
  hasAnyPermission: jest.fn(),
  hasAllPermissions: jest.fn(),
  getRolePermissions: jest.fn(),
}));
jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}));

import { getPermittedOrganizationIds } from '../permissions';

function actorRows(result: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(result),
  };
  return builder;
}

describe('getPermittedOrganizationIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps canonical membership order and skips workspaces without the permission', async () => {
    selectMock.mockReturnValueOnce(actorRows([{ isSuperAdmin: false, status: 'active' }]));
    listActiveOrganizationMembershipsMock.mockResolvedValueOnce([
      { id: 'membership-1', organizationId: 'org-member', role: 'member' },
      { id: 'membership-2', organizationId: 'org-admin', role: 'admin' },
      { id: 'membership-3', organizationId: 'org-owner', role: 'owner' },
    ]);

    await expect(getPermittedOrganizationIds('user-1', 'org:settings')).resolves.toEqual([
      'org-admin',
      'org-owner',
    ]);
  });

  it('rejects every workspace when the actor is inactive', async () => {
    selectMock.mockReturnValueOnce(actorRows([{ isSuperAdmin: true, status: 'inactive' }]));
    listActiveOrganizationMembershipsMock.mockResolvedValueOnce([
      { id: 'membership-1', organizationId: 'org-1', role: 'owner' },
    ]);

    await expect(getPermittedOrganizationIds('inactive-user', 'org:settings')).resolves.toEqual([]);
  });

  it('lets an active super admin use any canonical active membership', async () => {
    selectMock.mockReturnValueOnce(actorRows([{ isSuperAdmin: true, status: 'active' }]));
    listActiveOrganizationMembershipsMock.mockResolvedValueOnce([
      { id: 'membership-1', organizationId: 'org-1', role: 'viewer' },
    ]);

    await expect(getPermittedOrganizationIds('admin-1', 'org:settings')).resolves.toEqual([
      'org-1',
    ]);
  });
});
