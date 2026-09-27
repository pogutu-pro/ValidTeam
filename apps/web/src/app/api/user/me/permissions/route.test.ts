/**
 * @jest-environment node
 */

const authMock = jest.fn();
const resolveOrganizationAccessMock = jest.fn();

class MockNextResponse {
  constructor(
    private readonly payload: unknown,
    init?: { status?: number }
  ) {
    this.status = init?.status || 200;
  }

  status: number;

  async json() {
    return this.payload;
  }

  static json(payload: unknown, init?: { status?: number }) {
    return new MockNextResponse(payload, init);
  }
}

jest.mock('next/server', () => ({
  NextResponse: MockNextResponse,
}));

jest.mock('@/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

jest.mock('@/lib/auth/access-control', () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccessMock(...args),
}));

jest.mock('@tasknebula/db', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  getRolePermissions: (role: string) =>
    role === 'admin' ? ['org:view', 'project:create'] : ['org:view'],
  organizationMembers: {
    role: 'organizationMembers.role',
    status: 'organizationMembers.status',
    userId: 'organizationMembers.userId',
    organizationId: 'organizationMembers.organizationId',
  },
  SUPER_ADMIN_PERMISSIONS: ['system:manage'],
  users: {
    id: 'users.id',
    isSuperAdmin: 'users.isSuperAdmin',
  },
}));

describe('GET /api/user/me/permissions', () => {
  let GET: typeof import('./route').GET;

  beforeAll(async () => {
    ({ GET } = await import('./route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no permissions when the canonical organization boundary denies access', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    resolveOrganizationAccessMock.mockResolvedValue({
      allowed: false,
      isSuperAdmin: false,
      role: null,
      membershipId: null,
    });

    const response = await GET(
      new Request('http://localhost/api/user/me/permissions?organizationId=org-1') as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: 'org-1',
      role: null,
      isSuperAdmin: false,
      permissions: [],
    });
    expect(resolveOrganizationAccessMock).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('resolves role permissions from an allowed active organization access result', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    resolveOrganizationAccessMock.mockResolvedValue({
      allowed: true,
      isSuperAdmin: false,
      role: 'admin',
      membershipId: 'membership-1',
    });

    const response = await GET(
      new Request('http://localhost/api/user/me/permissions?organizationId=org-1') as never
    );

    await expect(response.json()).resolves.toMatchObject({
      organizationId: 'org-1',
      role: 'admin',
      permissions: ['org:view', 'project:create'],
    });
  });
});
