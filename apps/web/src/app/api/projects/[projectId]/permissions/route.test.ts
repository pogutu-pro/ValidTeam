const authMock = jest.fn();
const resolveProjectCapabilityAccessMock = jest.fn();

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

jest.mock('@/lib/auth/project-access', () => ({
  resolveProjectCapabilityAccess: (...args: unknown[]) =>
    resolveProjectCapabilityAccessMock(...args),
}));

jest.mock('@tasknebula/db', () => ({
  db: {
    select: jest.fn(),
  },
  users: {
    id: 'users.id',
    isSuperAdmin: 'users.isSuperAdmin',
  },
  organizationMembers: {
    userId: 'organizationMembers.userId',
    organizationId: 'organizationMembers.organizationId',
    status: 'organizationMembers.status',
    role: 'organizationMembers.role',
  },
  projectMembers: {
    userId: 'projectMembers.userId',
    projectId: 'projectMembers.projectId',
  },
  ROLE_DEFAULT_PERMISSIONS: {
    viewer: {},
  },
  hasPermission: jest.fn(),
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}));

describe('GET /api/projects/[projectId]/permissions', () => {
  let GET: typeof import('./route').GET;

  beforeAll(async () => {
    ({ GET } = await import('./route'));
  });

  beforeEach(() => {
    authMock.mockReset();
    resolveProjectCapabilityAccessMock.mockReset();
  });

  it('resolves projects through the scoped project resolver and hides unreadable projects', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const project = { id: 'project-1', organizationId: 'org-1', key: 'TASK' };
    resolveProjectCapabilityAccessMock.mockResolvedValue({
      project,
      canRead: false,
      permissions: {},
    });

    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: 'TASK' }),
    });

    expect(resolveProjectCapabilityAccessMock).toHaveBeenCalledWith('user-1', 'TASK');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found' });
  });
});
