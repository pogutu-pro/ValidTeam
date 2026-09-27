'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useProjectPermissions } from '@/lib/hooks/use-project-permissions';
import { stripLocalePrefix } from '@/components/layout/nav-paths';
import { cn } from '@/lib/utils';
import {
  PanelsTopLeft,
  Timer,
  BarChart3,
  Settings,
  BookOpenText,
  MessagesSquare,
  ChevronRight,
  Layers,
} from 'lucide-react';

type ProjectSummary = {
  id: string;
  key: string;
  name: string;
  organizationId: string;
};

interface ProjectLayoutClientProps {
  children: ReactNode;
  projectId: string;
  initialProject: ProjectSummary;
}

// Board + Backlog are reachable as view modes inside "Views" (and via direct
// URL); keeping them out of the top nav avoids duplicate entry points.
const tabs = [
  { labelKey: 'tabViews', href: 'views', icon: PanelsTopLeft },
  { labelKey: 'tabSprints', href: 'sprints', icon: Timer },
  { labelKey: 'tabModules', href: 'modules', icon: Layers },
  { labelKey: 'tabDocs', href: 'docs', icon: BookOpenText },
  { labelKey: 'tabChat', href: 'chat', icon: MessagesSquare },
  { labelKey: 'tabAnalytics', href: 'analytics', icon: BarChart3 },
] as const;

export function ProjectLayoutClient({
  children,
  projectId,
  initialProject,
}: ProjectLayoutClientProps) {
  const t = useTranslations('pagesProjects');
  const pathname = usePathname();
  const { permissions, isLoading: permissionsLoading } = useProjectPermissions(projectId);

  const { data: project } = useQuery<ProjectSummary | null>({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) return null;
      return response.json();
    },
    initialData: initialProject,
  });

  const { data: sprints } = useQuery({
    queryKey: ['sprints', projectId],
    queryFn: async () => {
      const response = await fetch(`/api/sprints?projectId=${projectId}`);
      if (!response.ok) return [];
      return response.json();
    },
  });

  const activeSprint = sprints?.find((s: { status: string }) => s.status === 'active');
  const normalizedPathname = stripLocalePrefix(pathname);
  const projectRoot = `/projects/${projectId}`;
  const matchedTab = tabs.find((tab) =>
    normalizedPathname.includes(`${projectRoot}/${tab.href}`)
  )?.href;
  const currentTab =
    normalizedPathname === projectRoot || normalizedPathname === `${projectRoot}/`
      ? 'views'
      : matchedTab;
  const isProjectSettingsActive = normalizedPathname.startsWith(`${projectRoot}/settings`);
  const hasProjectAccess =
    permissions.canBrowseProject ||
    permissions.isSuperAdmin ||
    permissions.isOrgOwner ||
    permissions.isOrgAdmin;
  const hasElevatedAccess =
    permissions.isSuperAdmin || permissions.isOrgOwner || permissions.isOrgAdmin;
  const canOpenSettings =
    hasElevatedAccess ||
    permissions.canAdministerProject ||
    permissions.canManageMembers ||
    permissions.canInviteMembers ||
    permissions.canChangeRoles ||
    permissions.canManageWorkflow;
  const visibleTabs = permissionsLoading
    ? tabs.filter((tab) => tab.href !== 'docs' && tab.href !== 'chat')
    : tabs.filter((tab) => {
        if (tab.href === 'docs') {
          return permissions.canBrowseDocs || hasElevatedAccess;
        }
        if (tab.href === 'chat') {
          return permissions.canBrowseChat || hasElevatedAccess;
        }
        return hasProjectAccess;
      });

  const activeTabValue = visibleTabs.some((tab) => tab.href === currentTab) ? currentTab : null;
  const projectName = project?.name || projectId;

  return (
    <TooltipProvider delayDuration={80}>
      <div className="flex h-full flex-col">
        <div className="bg-chrome text-chrome-foreground border-border shrink-0 border-b shadow-none">
          <div className="flex items-center gap-1.5 px-3 py-1 sm:gap-2 sm:px-4">
            <nav aria-label={t('breadcrumb')} className="flex min-w-0 items-center gap-1 text-xs">
              <Link
                href="/projects"
                className="text-muted-foreground hover:text-foreground inline-flex min-h-10 items-center transition-colors sm:min-h-8"
              >
                {t('title')}
              </Link>
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground h-3 w-3 shrink-0 rtl:rotate-180"
              />
            </nav>
            <span className="text-foreground min-w-0 truncate text-xs font-semibold">
              {projectName}
            </span>
            {project?.key ? (
              <span className="text-muted-foreground hidden font-mono text-[10px] uppercase tracking-[0.12em] sm:inline">
                {project.key}
              </span>
            ) : null}

            <div className="bg-border h-4 w-px" aria-hidden="true" />

            <nav
              aria-label={t('sections')}
              className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex h-auto max-w-full justify-start gap-0.5">
                {visibleTabs.map((tab) => {
                  const Icon = tab.icon;
                  const tabLabel = t(tab.labelKey);
                  const isActive = activeTabValue === tab.href;
                  return (
                    <Tooltip key={tab.href}>
                      <TooltipTrigger asChild>
                        <Link
                          href={`/projects/${projectId}/${tab.href}`}
                          aria-label={tabLabel}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 border-b border-transparent px-0 transition-[background-color,color,border-color] sm:h-8 sm:w-8 lg:w-auto lg:px-2.5',
                            isActive &&
                              'border-primary bg-primary/[0.07] text-foreground hover:bg-primary/10'
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="hidden text-xs font-medium lg:inline">{tabLabel}</span>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs lg:hidden">
                        {tabLabel}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </nav>

            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              {activeSprint ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/projects/${projectId}/sprints/${activeSprint.id}`}
                      className="live-pill inline-flex min-h-10 max-w-24 items-center gap-1 text-[10px] sm:min-h-8 sm:max-w-40"
                    >
                      <span className="truncate font-medium">{activeSprint.name}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {t('activeSprintTooltip', { count: activeSprint.issueCount ?? 0 })}
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {canOpenSettings ? (
                <Link
                  href={`/projects/${projectId}/settings`}
                  aria-label={t('projectSettings')}
                  aria-current={isProjectSettingsActive ? 'page' : undefined}
                  data-active={isProjectSettingsActive ? 'true' : undefined}
                  className={cn(
                    'text-muted-foreground hover:bg-accent hover:text-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border-b border-transparent px-2.5 text-xs font-medium transition-[background-color,color,border-color] sm:h-8',
                    isProjectSettingsActive &&
                      'border-primary bg-primary/[0.07] text-foreground hover:bg-primary/10'
                  )}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  <span>{t('settings')}</span>
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </TooltipProvider>
  );
}
