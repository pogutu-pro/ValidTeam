import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsMobileNavigation } from '../settings-mobile-navigation';
import { useOrganization } from '@/lib/hooks/use-organization';
import { useOrganizationPermissions } from '@/lib/hooks/use-permissions';

let mockPathname = '/settings';
let mockTab: string | null = null;
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? mockTab : null) }),
}));

jest.mock('@/lib/hooks/use-organization', () => ({
  useOrganization: jest.fn(),
}));

jest.mock('@/lib/hooks/use-permissions', () => ({
  useOrganizationPermissions: jest.fn(),
}));

const mockUseOrganization = useOrganization as unknown as jest.Mock;
const mockUseOrganizationPermissions = useOrganizationPermissions as jest.MockedFunction<
  typeof useOrganizationPermissions
>;

beforeAll(() => {
  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
      false;
  }
  if (
    !(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture
  ) {
    (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
      () => {};
  }
  if (!(Element.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture) {
    (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture =
      () => {};
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
});

describe('SettingsMobileNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/settings';
    mockTab = null;
    mockUseOrganization.mockReturnValue({ currentOrganizationId: 'org-1' });
    mockUseOrganizationPermissions.mockReturnValue({
      permissions: [],
      isSuperAdmin: false,
      role: 'owner',
      isLoading: false,
      has: jest.fn(() => true),
      hasAny: jest.fn(() => true),
      hasAll: jest.fn(() => true),
    });
  });

  it('lists every standalone settings surface and super-admin destination', async () => {
    const user = userEvent.setup();
    render(<SettingsMobileNavigation isSuperAdmin />);

    await user.click(screen.getByRole('combobox', { name: /settings/i }));

    expect(screen.getByRole('option', { name: /integrations/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /import issues/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /intake forms/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /single sign-on/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /audit streaming/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^admin$/i })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /^updates$/i }));
    expect(mockPush).toHaveBeenCalledWith('/admin?tab=updates');
  });

  it('keeps super-admin destinations hidden from regular members', async () => {
    const user = userEvent.setup();
    render(<SettingsMobileNavigation />);

    await user.click(screen.getByRole('combobox', { name: /settings/i }));

    expect(screen.queryByRole('option', { name: /^admin$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^updates$/i })).not.toBeInTheDocument();
  });

  it('keeps only personal settings when no workspace is available', async () => {
    const user = userEvent.setup();
    mockUseOrganization.mockReturnValue({ currentOrganizationId: null });

    render(<SettingsMobileNavigation />);
    await user.click(screen.getByRole('combobox', { name: /settings/i }));

    expect(screen.getByRole('option', { name: /appearance/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /organization/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /import issues/i })).not.toBeInTheDocument();
  });

  it('selects the intake-forms destination for nested edit routes', () => {
    mockPathname = '/tr/settings/intake-forms/form-1/edit';

    render(<SettingsMobileNavigation />);

    expect(screen.getByRole('combobox', { name: /settings/i })).toHaveTextContent('Intake forms');
  });
});
