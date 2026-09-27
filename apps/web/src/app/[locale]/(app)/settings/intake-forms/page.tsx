import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db, intakeForms, projects } from '@tasknebula/db';
import { desc, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { IntakeFormsList } from '@/components/intake/intake-forms-list';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('intakeForms.metaTitle') };
}

/**
 * Settings → Intake forms. Lists every form belonging to organizations
 * the caller is a member of, plus the project labels for context.
 */
export default async function IntakeFormsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/intake-forms');
  }

  const orgIds = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (orgIds.length === 0) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const forms = await db
    .select({
      id: intakeForms.id,
      slug: intakeForms.slug,
      title: intakeForms.title,
      description: intakeForms.description,
      isPublic: intakeForms.isPublic,
      projectId: intakeForms.projectId,
      updatedAt: intakeForms.updatedAt,
    })
    .from(intakeForms)
    .where(inArray(intakeForms.workspaceId, orgIds))
    .orderBy(desc(intakeForms.updatedAt));

  // Pull the small set of project labels we need so the list can show
  // "Project — Slug" without forcing an N+1 from the client.
  const projectIds = Array.from(new Set(forms.map((f) => f.projectId)));
  const projectRows = projectIds.length
    ? await db
        .select({ id: projects.id, name: projects.name, key: projects.key })
        .from(projects)
        .where(inArray(projects.id, projectIds))
    : [];

  const accessibleProjects = await db
    .select({ id: projects.id, name: projects.name, key: projects.key })
    .from(projects)
    .where(inArray(projects.organizationId, orgIds));

  const t = await getTranslations('pagesSettings');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('intakeForms.title')} description={t('intakeForms.subtitle')} />
      <IntakeFormsList
        forms={forms}
        projectLookup={Object.fromEntries(projectRows.map((p) => [p.id, p]))}
        accessibleProjects={accessibleProjects}
      />
    </PageFrame>
  );
}
