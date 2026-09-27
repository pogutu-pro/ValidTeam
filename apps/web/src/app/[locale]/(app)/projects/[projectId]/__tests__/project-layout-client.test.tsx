import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectLayoutClient } from '../project-layout-client';
import {
  useProjectPermissions,
  type UserProjectPermissions,
} from '@/lib/hooks/use-project-permissions';
import { usePathname } from 'next/navigation';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('@/lib/hooks/use-project-permissions', () => ({
  useProjectPermissions: jest.fn(),
}));

const mockUseProjectPermissions = useProjectPermissions as jest.MockedFunction<
  typeof useProjectPermissions
>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

const initialProject = {
  id: 'project-1',
  key: 'PRJ',
  name: 'Project One',
  organizationId: 'org-1',
};

function projectPermissions(
  overrides: Partial<UserProjectPermissions> = {}
): UserProjectPermissions {
  return {
    isMember: true,
    role: 'viewer',
    isSuperAdmin: false,
    isOrgOwner: false,
    isOrgAdmin: false,
    canBrowseProject: false,
    canAdministerProject: false,
    canBrowseDocs: false,
    canCreateDocs: false,
    canEditDocs: false,
    canDeleteDocs: false,
    canBrowseChat: false,
    canCreateChannels: false,
    canPostMessages: false,
    canModerateMessages: false,
    canStartCalls: false,
    canManageCalls: false,
    canManageSprints: false,
    canStartSprint: false,
    canCompleteSprint: false,
    canDeleteSprint: false,
    canCreateIssues: false,
    canEditIssues: false,
    canEditOwnIssues: false,
    canDeleteIssues: false,
    canDeleteOwnIssues: false,
    canAssignIssues: false,
    canAssigneeIssues: false,
    canTransitionIssues: false,
    canScheduleIssues: false,
    canMoveIssues: false,
    canLinkIssues: false,
    canCloseIssues: false,
    canReopenIssues: false,
    canAddComments: false,
    canEditOwnComments: false,
    canEditAllComments: false,
    canDeleteOwnComments: false,
    canDeleteAllComments: false,
    canCreateAttachments: false,
    canDeleteOwnAttachments: false,
    canDeleteAllAttachments: false,
    canManageWatchers: false,
    canViewWatchers: false,
    canManageMembers: false,
    canInviteMembers: false,
    canRemoveMembers: false,
    canChangeRoles: false,
    canManageWorkflow: false,
    canLogWork: false,
    canEditOwnWorklogs: false,
    canEditAllWorklogs: false,
    canDeleteOwnWorklogs: false,
    canDeleteAllWorklogs: false,
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePathname.mockReturnValue('/projects/prj/views');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as unknown as typeof fetch;
});

it('hides docs and chat tabs while project permissions are loading', () => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: projectPermissions(),
    isLoading: true,
    error: null,
  } as unknown as ReturnType<typeof useProjectPermissions>);

  render(
    <Wrapper>
      <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
        <div />
      </ProjectLayoutClient>
    </Wrapper>
  );

  expect(screen.getByRole('link', { name: /views/i })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: /breadcrumb/i }).querySelector('svg')).toHaveClass(
    'rtl:rotate-180'
  );
  expect(screen.queryByRole('link', { name: /docs/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /chat/i })).not.toBeInTheDocument();
});

it('hides docs, chat, and settings actions from read-only project viewers without those capabilities', () => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: projectPermissions({ canBrowseProject: true }),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjectPermissions>);

  render(
    <Wrapper>
      <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
        <div />
      </ProjectLayoutClient>
    </Wrapper>
  );

  expect(screen.getByRole('link', { name: /views/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /sprints/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /modules/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /docs/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /chat/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /project settings/i })).not.toBeInTheDocument();
});

it('shows project settings as a visible full-page destination for project administrators', () => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: projectPermissions({
      canBrowseProject: true,
      canAdministerProject: true,
    }),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjectPermissions>);

  render(
    <Wrapper>
      <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
        <div />
      </ProjectLayoutClient>
    </Wrapper>
  );

  const settingsLink = screen.getByRole('link', { name: /project settings/i });
  expect(settingsLink).toHaveAttribute('href', '/projects/prj/settings');
  expect(settingsLink).toHaveTextContent('Settings');
});

it('marks project settings active on settings deep links', () => {
  mockUsePathname.mockReturnValue('/tr/projects/prj/settings/workflows');
  mockUseProjectPermissions.mockReturnValue({
    permissions: projectPermissions({
      canBrowseProject: true,
      canManageWorkflow: true,
    }),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjectPermissions>);

  render(
    <Wrapper>
      <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
        <div />
      </ProjectLayoutClient>
    </Wrapper>
  );

  expect(screen.getByRole('link', { name: /project settings/i })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

it('shows docs and chat tabs only when their project permissions are present', () => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: projectPermissions({
      canBrowseProject: true,
      canBrowseDocs: true,
      canBrowseChat: true,
    }),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjectPermissions>);

  render(
    <Wrapper>
      <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
        <div />
      </ProjectLayoutClient>
    </Wrapper>
  );

  expect(screen.getByRole('link', { name: /docs/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /chat/i })).toBeInTheDocument();
});

it.each(['/tr/projects/prj', '/tr/projects/prj/views'])(
  'marks Views active for locale-prefixed project path %s',
  (pathname) => {
    mockUsePathname.mockReturnValue(pathname);
    mockUseProjectPermissions.mockReturnValue({
      permissions: projectPermissions({ canBrowseProject: true }),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectPermissions>);

    render(
      <Wrapper>
        <ProjectLayoutClient projectId="prj" initialProject={initialProject}>
          <h1>Views</h1>
        </ProjectLayoutClient>
      </Wrapper>
    );

    expect(screen.getByRole('link', { name: /views/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Project One' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Views', level: 1 })).toBeInTheDocument();
  }
);
