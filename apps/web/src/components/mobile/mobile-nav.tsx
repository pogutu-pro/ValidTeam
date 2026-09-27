'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderKanban, Home, Inbox, Layers, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { stripLocalePrefix } from '@/components/layout/nav-paths';

const navItems = [
  {
    labelKey: 'dashboard',
    href: '/dashboard',
    matches: ['/dashboard'],
    icon: Home,
  },
  {
    labelKey: 'inbox',
    href: '/inbox',
    matches: ['/inbox'],
    icon: Inbox,
  },
  {
    labelKey: 'myIssues',
    href: '/my-issues',
    matches: ['/my-issues', '/issues'],
    icon: Layers,
  },
  {
    labelKey: 'projects',
    href: '/projects',
    matches: ['/projects'],
    icon: FolderKanban,
  },
  {
    labelKey: 'settings',
    href: '/settings',
    matches: ['/settings'],
    icon: Settings,
  },
] as const;

export function MobileNav({ hasWorkspaceAccess = true }: { hasWorkspaceAccess?: boolean }) {
  const t = useTranslations('mobileNav');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const normalizedPathname = stripLocalePrefix(pathname);
  const visibleNavItems = hasWorkspaceAccess
    ? navItems
    : navItems.filter((item) => item.labelKey === 'dashboard' || item.labelKey === 'settings');

  return (
    <nav
      aria-label={t('primaryNavAria')}
      className="border-border/80 bg-chrome fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-14 items-center justify-around gap-1 px-2">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.matches.some(
            (match) => normalizedPathname === match || normalizedPathname.startsWith(`${match}/`)
          );
          const label = item.labelKey === 'inbox' ? tNav('inbox') : t(item.labelKey);

          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={isActive ? 'true' : undefined}
              className={cn(
                'ease-snap relative flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] font-medium transition-[color,background-color,box-shadow,opacity] duration-150',
                isActive
                  ? 'bg-primary/[0.07] text-primary'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate leading-tight">{label}</span>
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="bg-primary absolute inset-x-3 top-0 h-0.5 rounded-b-sm"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
