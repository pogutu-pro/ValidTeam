import { getTranslations } from 'next-intl/server';
import { WorkspaceRequiredNotice } from '@/components/layout/workspace-required-notice';
import { DraftsList } from '@/components/drafts/drafts-list';
import { currentUserHasWorkspaceAccess } from '@/lib/auth/workspace-access';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesHome');

  return {
    title: t('drafts_title'),
    description: t('drafts_subtitle'),
  };
}

export default async function DraftsPage() {
  const hasWorkspaceAccess = await currentUserHasWorkspaceAccess();
  if (!hasWorkspaceAccess) {
    return <WorkspaceRequiredNotice />;
  }

  const t = await getTranslations('pagesHome');
  return (
    <PageFrame contentClassName="max-w-7xl">
      <PageHeader title={t('drafts_title')} description={t('drafts_subtitle')} />
      <DraftsList />
    </PageFrame>
  );
}
