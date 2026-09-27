import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db, projects } from '@tasknebula/db';
import { asc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { ImportWizard } from './import-wizard';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('import.metaTitle') };
}

/**
 * Settings → Import page.
 *
 * Renders the source picker + adapter-specific form. Auth and membership
 * are enforced here so the client never needs to know about workspace
 * resolution.
 */
export default async function ImportSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/import');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const targetProjects = await db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.name));

  const t = await getTranslations('pagesSettings');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('import.title')} description={t('import.subtitle')} />
      <ImportWizard workspaceId={organizationId} projects={targetProjects} />
    </PageFrame>
  );
}
