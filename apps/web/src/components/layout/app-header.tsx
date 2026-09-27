'use client';

import Link from 'next/link';
import { Search, HelpCircle, Command } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { OrganizationSwitcher } from '@/components/organization/organization-switcher';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { useCommandPalette } from '@/lib/command/use-command-palette';

export function AppHeader({ hasWorkspaceAccess = true }: { hasWorkspaceAccess?: boolean }) {
  const tNav = useTranslations('nav');
  const tActions = useTranslations('actions');
  const { open: openPalette } = useCommandPalette();

  return (
    <header className="workbench-commandbar border-border sticky top-0 z-30 flex h-11 items-center justify-between border-b px-3 shadow-none">
      {/* Workspace + search trigger */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {hasWorkspaceAccess ? (
          <>
            <OrganizationSwitcher />
            <button
              type="button"
              onClick={openPalette}
              aria-label={tActions('open_command_palette')}
              className="border-border bg-card/70 text-muted-foreground ease-snap focus-visible:border-ring focus-visible:ring-ring hover:border-border-strong hover:bg-card hover:text-foreground group relative flex h-8 w-full max-w-2xl items-center rounded-md border pe-2 ps-9 text-start text-[13px] transition-[color,background-color,border-color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              <Search className="text-muted-foreground absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <span className="truncate">{tNav('search_placeholder')}</span>
              <kbd className="border-border bg-muted text-muted-foreground pointer-events-none ms-auto inline-flex shrink-0 select-none items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]">
                <Command className="h-3 w-3" />
                {'K'}
              </kbd>
            </button>
          </>
        ) : null}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-0.5">
        {hasWorkspaceAccess ? <NotificationBell /> : null}
        <LanguageSwitcher />
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="text-muted-foreground ease-snap hover:text-foreground h-8 w-8 transition-[color,background-color,border-color,box-shadow,opacity] duration-150"
        >
          <Link href="/api-docs" aria-label={tActions('help')}>
            <HelpCircle className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
