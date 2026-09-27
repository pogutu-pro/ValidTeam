'use client';

import { useTranslations } from 'next-intl';
import { useOrganization } from '@/lib/hooks/use-organization';
import { LabelsManager } from './labels-manager';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Client shell for the standalone /settings/labels page. Resolves the active
 * organization from the workspace switcher store (same source as the tabbed
 * org settings page) and renders the header + manager.
 */
export function LabelsSettingsClient() {
  const t = useTranslations('settings.labels');
  const tCommon = useTranslations('common');
  const { currentOrganizationId } = useOrganization();

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {currentOrganizationId ? (
        <LabelsManager organizationId={currentOrganizationId} />
      ) : (
        <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
      )}
    </PageFrame>
  );
}
