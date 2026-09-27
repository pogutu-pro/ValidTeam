import { isSuperAdmin } from '@/lib/auth/permissions';
import { SettingsMobileNavigation } from '@/components/settings/settings-mobile-navigation';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const hasSuperAdminAccess = await isSuperAdmin();

  return (
    <>
      <SettingsMobileNavigation isSuperAdmin={hasSuperAdminAccess} />
      {children}
    </>
  );
}
