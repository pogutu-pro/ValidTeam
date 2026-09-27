import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { EditUserDialog } from '../edit-user-dialog';

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

class ResizeObserverMock {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

describe('EditUserDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts the status select only after API state has hydrated the form', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'inactive-user',
        name: 'Inactive user',
        email: 'inactive@example.com',
        status: 'inactive',
        isSuperAdmin: false,
      }),
    }) as jest.MockedFunction<typeof fetch>;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditUserDialog userId="inactive-user" open onOpenChange={jest.fn()} />
      </QueryClientProvider>
    );

    expect(await screen.findByText('inactive@example.com')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Inactive');
    expect(screen.getByRole('switch', { name: 'Super admin' })).not.toBeChecked();
  });
});
