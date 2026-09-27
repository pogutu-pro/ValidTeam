import { render, screen } from '@testing-library/react';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import SignInPage from '../page';

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

jest.mock('@/components/auth/signin-form', () => ({
  SignInForm: () => <div data-testid="signin-form" />,
}));

jest.mock('@/components/auth/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const authMock = auth as jest.MockedFunction<typeof auth>;
const redirectMock = redirect as unknown as jest.MockedFunction<(url: string) => never>;

describe('SignInPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sign in when durable authentication rejects a stale JWT', async () => {
    authMock.mockResolvedValue(null);

    render(await SignInPage());

    expect(screen.getByTestId('signin-form')).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects a durably active session to the dashboard', async () => {
    authMock.mockResolvedValue({
      user: { id: 'active-user' },
      expires: '2099-01-01T00:00:00.000Z',
    });

    await expect(SignInPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});
