/**
 * @jest-environment node
 */

const authMock = jest.fn();
const selectMock = jest.fn();
const neMock = jest.fn((left: unknown, right: unknown) => ({ type: 'ne', left, right }));

jest.mock('@/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

jest.mock('@validteam/db', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
  users: { id: 'users.id', isSuperAdmin: 'users.isSuperAdmin', status: 'users.status' },
  organizationMembers: {
    userId: 'organizationMembers.userId',
    organizationId: 'organizationMembers.organizationId',
    status: 'organizationMembers.status',
  },
  organizations: { id: 'organizations.id', status: 'organizations.status' },
}));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  ne: (...args: unknown[]) => neMock(...args),
}));

import {
  currentUserWorkspaceAccessContext,
  getUserWorkspaceAccessContext,
} from '../workspace-access';

function rows(result: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    innerJoin: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(result),
  };
  return builder;
}

describe('workspace access context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an active membership as the stable initial organization', async () => {
    selectMock
      .mockReturnValueOnce(rows([{ isSuperAdmin: false, status: 'active' }]))
      .mockReturnValueOnce(rows([{ organizationId: 'org-1' }]));

    await expect(getUserWorkspaceAccessContext('user-1')).resolves.toEqual({
      hasAccess: true,
      defaultOrganizationId: 'org-1',
    });
    expect(neMock).toHaveBeenCalledWith('organizations.status', 'suspended');
  });

  it('denies an inactive user without looking up memberships', async () => {
    selectMock.mockReturnValueOnce(rows([{ isSuperAdmin: true, status: 'inactive' }]));

    await expect(getUserWorkspaceAccessContext('user-1')).resolves.toEqual({
      hasAccess: false,
      defaultOrganizationId: null,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('keeps an active super admin in the app without inventing an organization', async () => {
    selectMock
      .mockReturnValueOnce(rows([{ isSuperAdmin: true, status: 'active' }]))
      .mockReturnValueOnce(rows([]));

    await expect(getUserWorkspaceAccessContext('admin-1')).resolves.toEqual({
      hasAccess: true,
      defaultOrganizationId: null,
    });
  });

  it('returns an empty context for an anonymous request', async () => {
    authMock.mockResolvedValue(null);

    await expect(currentUserWorkspaceAccessContext()).resolves.toEqual({
      hasAccess: false,
      defaultOrganizationId: null,
    });
    expect(selectMock).not.toHaveBeenCalled();
  });
});
