import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const updateIssueMutateAsyncMock = jest.fn();
const createSubIssueMutateAsyncMock = jest.fn();

jest.mock('@/lib/hooks/use-issues', () => ({
  useUpdateIssue: () => ({
    mutateAsync: updateIssueMutateAsyncMock,
    isPending: false,
  }),
}));

jest.mock('@/lib/hooks/use-subtask-create', () => ({
  useCreateSubIssue: () => ({
    mutateAsync: createSubIssueMutateAsyncMock,
    isPending: false,
  }),
  useSubIssueParentContext: () => ({
    data: { projectId: 'project-1', sprintId: null, epicId: null },
  }),
}));

import { IssueSubtasks } from '../issue-subtasks';

const statuses = [
  { id: 'backlog', category: 'backlog', position: 0 },
  { id: 'in-progress', category: 'in_progress', position: 1 },
  { id: 'done', category: 'done', position: 2 },
];

const transitions = [
  {
    id: 'start',
    name: 'Start Progress',
    fromStatusId: 'backlog',
    toStatusId: 'in-progress',
  },
  {
    id: 'complete',
    name: 'Complete',
    fromStatusId: 'in-progress',
    toStatusId: 'done',
  },
  {
    id: 'return',
    name: 'Return to Backlog',
    fromStatusId: 'in-progress',
    toStatusId: 'backlog',
  },
  {
    id: 'reopen',
    name: 'Reopen to Backlog',
    fromStatusId: 'done',
    toStatusId: 'backlog',
  },
];

function response(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

function makeSubtask(statusId: string, status: string) {
  return {
    id: 'subtask-1',
    key: 'TN-2',
    title: 'Verify workflow-aware completion',
    statusId,
    status,
    statusName: status,
    priority: 'medium',
  };
}

function renderPanel(subtask: ReturnType<typeof makeSubtask>) {
  const fetchMock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/workflow-transitions')) {
      return response({ statuses, transitions });
    }
    if (url.includes('/api/issues?parentId=')) {
      return response({ issues: [subtask] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  global.fetch = fetchMock as typeof fetch;

  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  render(
    <Wrapper>
      <IssueSubtasks issueId="parent-1" projectId="project-1" />
    </Wrapper>
  );

  return fetchMock;
}

describe('IssueSubtasks workflow transitions', () => {
  beforeEach(() => {
    updateIssueMutateAsyncMock.mockReset();
    updateIssueMutateAsyncMock.mockResolvedValue({ id: 'subtask-1' });
    createSubIssueMutateAsyncMock.mockReset();
  });

  it('advances a backlog sub-issue through the configured legal next step', async () => {
    const user = userEvent.setup();
    renderPanel(makeSubtask('backlog', 'backlog'));

    const advance = await screen.findByRole('button', { name: 'Start Progress' });
    await user.click(advance);

    await waitFor(() =>
      expect(updateIssueMutateAsyncMock).toHaveBeenCalledWith({
        issueId: 'subtask-1',
        data: { statusId: 'in-progress' },
      })
    );
  });

  it('prefers completion over a backwards transition from in progress', async () => {
    const user = userEvent.setup();
    renderPanel(makeSubtask('in-progress', 'in_progress'));

    const complete = await screen.findByRole('button', { name: 'Complete' });
    await user.click(complete);

    await waitFor(() =>
      expect(updateIssueMutateAsyncMock).toHaveBeenCalledWith({
        issueId: 'subtask-1',
        data: { statusId: 'done' },
      })
    );
  });

  it('recognizes the API status field as done and offers the legal reopen edge', async () => {
    renderPanel(makeSubtask('done', 'done'));

    expect(await screen.findByText('1/1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /TN-2/ })).toHaveClass('line-through');
    expect(screen.getByRole('button', { name: 'Reopen to Backlog' })).toBeEnabled();
  });

  it('shows a localized error when a legal transition is rejected', async () => {
    const user = userEvent.setup();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    updateIssueMutateAsyncMock.mockRejectedValueOnce(new Error('rejected'));
    renderPanel(makeSubtask('backlog', 'backlog'));

    await user.click(await screen.findByRole('button', { name: 'Start Progress' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't update the sub-issue status. Please try again."
    );
    expect(consoleError).toHaveBeenCalledWith('Error updating subtask:', expect.any(Error));
    consoleError.mockRestore();
  });
});
