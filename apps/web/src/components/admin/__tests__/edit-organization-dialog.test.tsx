import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { EditOrganizationDialog } from '../edit-organization-dialog';

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

describe('EditOrganizationDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for API data before mounting controlled selects', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'org-trial',
        name: 'Trial workspace',
        slug: 'trial-workspace',
        plan: 'growth',
        status: 'trial',
        domain: null,
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditOrganizationDialog organizationId="org-trial" open onOpenChange={jest.fn()} />
      </QueryClientProvider>
    );

    expect(await screen.findByLabelText('Name')).toHaveValue('Trial workspace');
    expect(screen.getByRole('combobox', { name: 'Plan' })).toHaveTextContent('Growth');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Trial');
  });
});
