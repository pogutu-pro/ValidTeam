import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTranslations } from 'next-intl/server';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { IntegrationsGrid } from '@/components/settings/integrations-grid';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('integrations.metaTitle') };
}

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/integrations');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const t = await getTranslations('pagesSettings');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('integrations.title')} description={t('integrations.subtitle')} />
      <IntegrationsGrid />
    </PageFrame>
  );
}
