'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Permission } from '@validteam/db';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { stripLocalePrefix } from '@/components/layout/nav-paths';
import { useOrganization } from '@/lib/hooks/use-organization';
import { useOrganizationPermissions } from '@/lib/hooks/use-permissions';

type SettingsNavigationItem = {
  href: string;
  labelKey: string;
  labelNamespace: 'nav' | 'pagesSettings';
  requiredPermission?: Permission;
  personal?: boolean;
  superAdminOnly?: boolean;
};

const SETTINGS_NAVIGATION_ITEMS: readonly SettingsNavigationItem[] = [
  {
    href: '/settings?tab=organization',
    labelKey: 'organization',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings?tab=members',
    labelKey: 'members',
    labelNamespace: 'nav',
    requiredPermission: 'member:view',
  },
  { href: '/settings?tab=labels', labelKey: 'labels', labelNamespace: 'nav' },
  {
    href: '/settings/integrations',
    labelKey: 'integrations',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings/import',
    labelKey: 'import.title',
    labelNamespace: 'pagesSettings',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings/intake-forms',
    labelKey: 'intakeForms.title',
    labelNamespace: 'pagesSettings',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings/sso',
    labelKey: 'sso.title',
    labelNamespace: 'pagesSettings',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings/security/audit-log-streaming',
    labelKey: 'audit_streaming',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings?tab=api-keys',
    labelKey: 'api_keys',
    labelNamespace: 'nav',
    requiredPermission: 'api_key:view',
  },
  {
    href: '/settings?tab=webhooks',
    labelKey: 'webhooks',
    labelNamespace: 'nav',
    requiredPermission: 'webhook:view',
  },
  {
    href: '/settings?tab=ai-agents',
    labelKey: 'ai_agents',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings?tab=ai-transparency',
    labelKey: 'ai_transparency',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  {
    href: '/settings?tab=communications',
    labelKey: 'communications',
    labelNamespace: 'nav',
    requiredPermission: 'org:settings',
  },
  { href: '/settings?tab=notifications', labelKey: 'notifications', labelNamespace: 'nav' },
  {
    href: '/settings?tab=appearance',
    labelKey: 'appearance',
    labelNamespace: 'nav',
    personal: true,
  },
  {
    href: '/settings?tab=audit-log',
    labelKey: 'activity',
    labelNamespace: 'nav',
    requiredPermission: 'org:manage',
  },
  {
    href: '/admin',
    labelKey: 'admin',
    labelNamespace: 'nav',
    superAdminOnly: true,
  },
  {
    href: '/admin?tab=updates',
    labelKey: 'updates',
    labelNamespace: 'nav',
    superAdminOnly: true,
  },
];

function resolveActiveHref(
  pathname: string | null,
  tab: string | null,
  visibleItems: readonly SettingsNavigationItem[]
): string | undefined {
  const path = stripLocalePrefix(pathname);

  if (path === '/settings') {
    const requestedHref = `/settings?tab=${tab ?? 'organization'}`;
    return visibleItems.some((item) => item.href === requestedHref)
      ? requestedHref
      : visibleItems[0]?.href;
  }

  const standaloneMatch = visibleItems.find((item) => {
    if (item.href.includes('?')) return false;
    const itemPath = item.href.split('?')[0];
    return path === itemPath || path.startsWith(`${itemPath}/`);
  });

  return standaloneMatch?.href ?? visibleItems[0]?.href;
}

export function SettingsMobileNavigation({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tNav = useTranslations('nav');
  const tSettings = useTranslations('pagesSettings');
  const { currentOrganizationId } = useOrganization();
  const permissions = useOrganizationPermissions(currentOrganizationId ?? undefined);
  const hasSuperAdminAccess = isSuperAdmin || permissions.isSuperAdmin;

  const visibleItems = SETTINGS_NAVIGATION_ITEMS.filter((item) => {
    if (item.superAdminOnly) return hasSuperAdminAccess;
    if (!currentOrganizationId) return item.personal === true;
    if (hasSuperAdminAccess || !item.requiredPermission) return true;
    return !permissions.isLoading && permissions.has(item.requiredPermission);
  });

  const activeHref = resolveActiveHref(pathname, searchParams.get('tab'), visibleItems);

  return (
    <div className="border-border bg-chrome border-b px-3 py-2 md:hidden">
      <Select value={activeHref} onValueChange={(href) => router.push(href)}>
        <SelectTrigger aria-label={tNav('settings')} className="h-10 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {visibleItems.map((item) => (
            <SelectItem key={item.href} value={item.href}>
              {item.labelNamespace === 'pagesSettings'
                ? tSettings(item.labelKey)
                : tNav(item.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
