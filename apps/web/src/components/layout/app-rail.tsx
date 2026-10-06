'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BookOpenText,
  Flag,
  FolderKanban,
  Inbox,
  Layers,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Video,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInbox } from '@/lib/hooks/use-inbox';
import { useOrganization } from '@/lib/hooks/use-organization';
import { useOrganizationPermissions, type Permission } from '@/lib/hooks/use-permissions';
import { stripLocalePrefix } from '@/components/layout/nav-paths';
import { UserProfileDropdown } from '@/components/user/user-profile-dropdown';

interface RailItem {
  name: string;
  href: string;
  icon: LucideIcon;
  showBadge?: boolean;
  requiredAnyPermissions?: Permission[];
}

// Rail items declare a translation key (resolved against `nav`) instead of
// inline English so the rail respects the user's chosen locale. The
// `href` stays language-agnostic; next-intl handles the `/[locale]` prefix
// at render time via `useTranslations('nav')`.
type RailItemKey =
  | 'home'
  | 'inbox'
  | 'my_issues'
  | 'initiatives'
  | 'projects'
  | 'docs'
  | 'meetings'
  | 'team'
  | 'settings';

const railItems: (Omit<RailItem, 'name'> & { key: RailItemKey })[] = [
  { key: 'home', href: '/dashboard', icon: LayoutDashboard },
  { key: 'inbox', href: '/inbox', icon: Inbox, showBadge: true },
  { key: 'my_issues', href: '/my-issues', icon: Layers },
  // Goals roll up progress across projects, so they sit above Projects: the
  // "why" before the "what".
  { key: 'initiatives', href: '/initiatives', icon: Flag },
  { key: 'projects', href: '/projects', icon: FolderKanban },
  { key: 'docs', href: '/docs', icon: BookOpenText },
  { key: 'meetings', href: '/meetings', icon: Video },
  { key: 'team', href: '/team', icon: Users, requiredAnyPermissions: ['member:view', 'team:view'] },
  { key: 'settings', href: '/settings', icon: Settings },
];

export function AppRail({
  hasWorkspaceAccess = true,
  isSuperAdmin = false,
  contextCollapsed = false,
  onToggleContext,
}: {
  hasWorkspaceAccess?: boolean;
  isSuperAdmin?: boolean;
  contextCollapsed?: boolean;
  onToggleContext?: () => void;
}) {
  const pathname = usePathname();
  const normalizedPathname = stripLocalePrefix(pathname);
  const tNav = useTranslations('nav');
  const tLayout = useTranslations('layoutNav');
  const tShell = useTranslations('collab.shell');
  const { currentOrganizationId } = useOrganization();
  const { hasAny: hasAnyOrgPermission, isLoading: isLoadingOrgPermissions } =
    useOrganizationPermissions(currentOrganizationId ?? undefined);
  // Lightweight unread count — keys on { unread: true } so the response is
  // small (just unread items, first page). Refetches every minute via the
  // hook's `refetchInterval`.
  const { data: inboxUnread } = useInbox({
    unread: true,
    limit: 50,
    enabled: hasWorkspaceAccess,
  });
  const unreadInboxCount = inboxUnread?.items?.length ?? 0;
  const visibleRailItems = railItems.filter((item) => {
    if (!hasWorkspaceAccess) {
      return item.key === 'home' || item.key === 'settings';
    }
    if (!item.requiredAnyPermissions) {
      return true;
    }
    return !isLoadingOrgPermissions && hasAnyOrgPermission(item.requiredAnyPermissions);
  });

  return (
    <nav
      aria-label={tLayout('workspaceRail')}
      className="workbench-rail border-border flex h-dvh w-52 shrink-0 flex-col border-e px-2 py-2"
    >
      {onToggleContext ? (
        <button
          type="button"
          onClick={onToggleContext}
          aria-label={contextCollapsed ? tShell('expand') : tShell('collapse')}
          aria-expanded={!contextCollapsed}
          aria-controls="workbench-context-panel"
          className="ease-snap text-workbench-rail-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          {contextCollapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
      ) : null}

      <ul className="flex flex-1 flex-col gap-0.5">
        {visibleRailItems.map((item) => {
          const label = tNav(item.key);
          const isActive =
            normalizedPathname === item.href ||
            normalizedPathname.startsWith(item.href + '/') ||
            (item.href === '/dashboard' &&
              (normalizedPathname === '/' ||
                normalizedPathname.startsWith('/drafts') ||
                normalizedPathname.startsWith('/templates'))) ||
            (item.href === '/my-issues' && normalizedPathname.startsWith('/issues/'));
          const Icon = item.icon;
          const showInboxBadge = item.showBadge && unreadInboxCount > 0;
          const unreadLabel = tNav('inbox_unread', { count: unreadInboxCount });

          return (
            <li key={item.key} className="w-full">
              <Link
                href={item.href}
                data-active={isActive ? 'true' : undefined}
                aria-label={showInboxBadge ? `${label} · ${unreadLabel}` : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'row-interactive text-muted-foreground ease-snap hover:bg-accent/70 hover:text-foreground focus-visible:ring-ring flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-[color,background-color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                  isActive && 'bg-primary/[0.07] text-foreground hover:bg-primary/[0.12]'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {showInboxBadge ? (
                  <span
                    aria-hidden="true"
                    data-testid="inbox-unread-badge"
                    className="bg-primary text-primary-foreground flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                  >
                    {unreadInboxCount > 9 ? '9+' : unreadInboxCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-border mt-1 flex flex-col gap-0.5 border-t pt-1">
        {isSuperAdmin ? (
          <Link
            href="/admin"
            data-active={normalizedPathname.startsWith('/admin') ? 'true' : undefined}
            aria-current={normalizedPathname.startsWith('/admin') ? 'page' : undefined}
            className={cn(
              'row-interactive text-muted-foreground ease-snap hover:bg-accent/70 hover:text-foreground focus-visible:ring-ring flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-[color,background-color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
              normalizedPathname.startsWith('/admin') &&
                'bg-primary/[0.07] text-foreground hover:bg-primary/[0.12]'
            )}
          >
            <Shield className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{tNav('admin')}</span>
          </Link>
        ) : null}

        <UserProfileDropdown
          side="right"
          align="end"
          showDetails
          triggerClassName="group text-muted-foreground hover:bg-accent/70 hover:text-foreground focus-visible:ring-ring h-9 w-full justify-start gap-2.5 rounded-md border-0 bg-transparent px-2.5 shadow-none ring-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
          avatarClassName="h-6 w-6 shrink-0"
          fallbackClassName="text-[10px]"
        />
      </div>
    </nav>
  );
}

export default AppRail;
