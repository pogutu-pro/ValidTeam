/**
 * @jest-environment node
 */

const authMock = jest.fn();
const ensureProjectDocumentSpaceMock = jest.fn();
const getProjectDocumentPermissionsMock = jest.fn();
const resolveProjectIdMock = jest.fn();

jest.mock('@/auth', () => ({ auth: (...args: unknown[]) => authMock(...args) }));
jest.mock('@validteam/db', () => ({
  db: {},
  documentSpaces: {},
  projects: { id: 'projects.id', organizationId: 'projects.organizationId' },
  eq: jest.fn(),
}));
jest.mock('@/lib/docs/content', () => ({ slugifyDocumentTitle: jest.fn() }));
jest.mock('@/lib/docs/server', () => ({
  ensureProjectDocumentSpace: (...args: unknown[]) => ensureProjectDocumentSpaceMock(...args),
  getOrgDocumentPermissions: jest.fn(),
  getOrganizationRole: jest.fn(),
  getProjectDocumentPermissions: (...args: unknown[]) => getProjectDocumentPermissionsMock(...args),
  getUserFlags: jest.fn().mockResolvedValue({ isSuperAdmin: false }),
  listAccessibleDocumentSpaces: jest.fn(),
  resolveOrganizationIdForUser: jest.fn(),
  resolveProjectId: (...args: unknown[]) => resolveProjectIdMock(...args),
}));

import { POST } from './route';

describe('POST /api/docs/spaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    resolveProjectIdMock.mockResolvedValue('project-1');
  });

  it('does not create or reveal a project space without create permission', async () => {
    getProjectDocumentPermissionsMock.mockResolvedValue({
      canBrowse: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });

    const response = await POST({
      json: async () => ({ scope: 'project', projectId: 'TN', name: 'Docs' }),
    } as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    expect(resolveProjectIdMock).toHaveBeenCalledWith('TN', 'user-1');
    expect(ensureProjectDocumentSpaceMock).not.toHaveBeenCalled();
  });
});
