'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { ApiKeysManager } from '@/components/settings/api-keys-manager';
import { WebhooksManager } from '@/components/settings/webhooks-manager';
import { AuditLogViewer } from '@/components/audit/audit-log-viewer';
import { NotificationPreferences } from '@/components/settings/notification-preferences';
import { AppearanceSettings } from '@/components/settings/appearance-settings';
import { OrganizationAiAgentsSettings } from '@/components/settings/organization-ai-agents';
import { OrganizationCommunicationsSettings } from '@/components/settings/organization-communications-settings';
import { LabelsManager } from '@/components/settings/labels-manager';
import { MembersPageClient } from './members/members-page-client';
import { OrganizationSettingsClient } from './organization/organization-settings-client';
import { AiTransparencyClient } from './ai-transparency/ai-transparency-client';
import { useOrganization } from '@/lib/hooks/use-organization';
import { useAiFeature } from '@/lib/hooks/use-ai-feature';
import { useOrganizationPermissions } from '@/lib/hooks/use-permissions';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';
import type { Permission } from '@validteam/db';

type NavItem = {
  value:
    | 'organization'
    | 'members'
    | 'api-keys'
    | 'webhooks'
    | 'labels'
    | 'notifications'
    | 'appearance'
    | 'ai-agents'
    | 'ai-transparency'
    | 'communications'
    | 'audit-log';
  labelKey: string;
  // Permission required to see this tab. `undefined` means every member sees it.
  requiredPermissions?: Permission;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    value: 'organization',
    labelKey: 'nav.organization',
    requiredPermissions: 'org:settings',
  },
  {
    // Every member can view members; `member:invite` is enforced inside the manager.
    value: 'members',
    labelKey: 'nav.members',
    requiredPermissions: 'member:view',
  },
  {
    value: 'api-keys',
    labelKey: 'nav.apiKeys',
    requiredPermissions: 'api_key:view',
  },
  {
    value: 'webhooks',
    labelKey: 'nav.webhooks',
    requiredPermissions: 'webhook:view',
  },
  { value: 'labels', labelKey: 'nav.labels' },
  { value: 'notifications', labelKey: 'nav.notifications' },
  { value: 'appearance', labelKey: 'nav.appearance' },
  {
    value: 'ai-agents',
    labelKey: 'nav.aiAgents',
    requiredPermissions: 'org:settings',
  },
  {
    value: 'ai-transparency',
    labelKey: 'aiTransparency.title',
    requiredPermissions: 'org:settings',
  },
  {
    value: 'communications',
    labelKey: 'nav.communications',
    requiredPermissions: 'org:settings',
  },
  {
    value: 'audit-log',
    labelKey: 'nav.activity',
    requiredPermissions: 'org:manage',
  },
] as const;

type TabValue = NavItem['value'];

const PERSONAL_TABS = new Set<TabValue>(['appearance']);
const UNGATED_TABS = new Set<TabValue>(['labels', 'notifications', 'appearance']);

export default function SettingsPage() {
  const tNav = useTranslations('nav');
  const { currentOrganizationId } = useOrganization();
  const { aiEnabled } = useAiFeature();
  const perms = useOrganizationPermissions(currentOrganizationId ?? undefined);
  const searchParams = useSearchParams();

  const visibleNavItems = useMemo<readonly NavItem[]>(() => {
    if (!currentOrganizationId) {
      return NAV_ITEMS.filter((item) => PERSONAL_TABS.has(item.value));
    }
    if (perms.isLoading) {
      return NAV_ITEMS.filter((item) => UNGATED_TABS.has(item.value));
    }
    return NAV_ITEMS.filter((item) => {
      if (!item.requiredPermissions) return true;
      return perms.has(item.requiredPermissions);
    });
  }, [currentOrganizationId, perms]);

  const validTabs = useMemo(() => visibleNavItems.map((item) => item.value), [visibleNavItems]);

  const requestedTab = searchParams.get('tab') as TabValue | null;
  const initialTab: TabValue = useMemo(() => {
    if (requestedTab && (validTabs as readonly string[]).includes(requestedTab)) {
      return requestedTab;
    }
    // Fallback: prefer 'organization' when visible, otherwise the first tab.
    if ((validTabs as readonly string[]).includes('organization')) {
      return 'organization';
    }
    return (validTabs[0] ?? 'appearance') as TabValue;
  }, [requestedTab, validTabs]);

  const activeTab = initialTab;

  // Permission-aware content: a direct navigation to a gated tab that the user
  // is not authorised for shows a friendly notice instead of the manager.
  const activeNavItem = NAV_ITEMS.find((item) => item.value === activeTab);
  const activeTabRequires = activeNavItem?.requiredPermissions;
  const activeTabDenied =
    !perms.isLoading && activeTabRequires !== undefined && !perms.has(activeTabRequires);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageFrame className="flex-1" contentClassName="max-w-5xl">
        <PageHeader title={tNav('settings')} />
        <div className="min-w-0" data-settings-tab={activeTab}>
          {activeTabDenied ? (
            <NoAccessNotice />
          ) : (
            renderContent(activeTab, currentOrganizationId, aiEnabled)
          )}
        </div>
      </PageFrame>
    </div>
  );
}

function renderContent(tab: TabValue, organizationId: string | null, aiEnabled: boolean) {
  switch (tab) {
    case 'appearance':
      return <AppearanceSettings />;
    case 'organization':
      if (!organizationId) return <NoAccessNotice />;
      return <OrganizationSettingsClient />;
    case 'members':
      if (!organizationId) return <NoAccessNotice />;
      return <MembersPageClient />;
    case 'ai-agents':
      if (!organizationId) return <NoAccessNotice />;
      if (!aiEnabled) return <AiDisabledNotice />;
      return <OrganizationAiAgentsSettings organizationId={organizationId} />;
    case 'ai-transparency':
      if (!organizationId) return <NoAccessNotice />;
      return <AiTransparencyClient organizationId={organizationId} headingLevel={2} />;
    case 'communications':
      if (!organizationId) return <NoAccessNotice />;
      return <OrganizationCommunicationsSettings organizationId={organizationId} />;
    case 'labels':
      if (!organizationId) return <NoAccessNotice />;
      return <LabelsManager organizationId={organizationId} />;
    case 'notifications':
      if (!organizationId) return <NoAccessNotice />;
      return <NotificationPreferences />;
    case 'api-keys':
      if (!organizationId) return <NoAccessNotice />;
      return <ApiKeysManager organizationId={organizationId} />;
    case 'webhooks':
      if (!organizationId) return <NoAccessNotice />;
      return <WebhooksManager organizationId={organizationId} />;
    case 'audit-log':
      if (!organizationId) return <NoAccessNotice />;
      return <AuditLogViewer organizationId={organizationId} />;
    default:
      return null;
  }
}

function AiDisabledNotice() {
  const t = useTranslations('pagesSettings');
  return (
    <div className="surface-card space-y-2 p-8 text-center">
      <p className="text-foreground text-sm font-medium">{t('aiDisabled.title')}</p>
      <p className="text-muted-foreground text-sm">
        {t.rich('aiDisabled.body', {
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
    </div>
  );
}

function NoAccessNotice() {
  const t = useTranslations('pagesSettings');
  return (
    <div className="surface-card space-y-2 p-8 text-center">
      <p className="text-foreground text-sm font-medium">{t('noAccess.title')}</p>
      <p className="text-muted-foreground text-sm">{t('noAccess.body')}</p>
    </div>
  );
}
