import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { ProjectAccessDenied } from '@/components/projects/project-access-denied';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import { VersionsManager } from '@/components/settings/versions-manager';
import { PageFrame } from '@/components/ui/page-frame';

export default async function ProjectVersionsSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/signin?callbackUrl=/projects/${projectId}/settings/versions`);
  }

  const access = await resolveProjectCapabilityAccess(session.user.id, projectId);
  const canAccess =
    access.canRead &&
    (access.canManage || access.isSuperAdmin || access.isOrgOwner || access.isOrgAdmin);

  if (!canAccess) {
    return <ProjectAccessDenied />;
  }

  const t = await getTranslations('settings.versions');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <h1 className="sr-only">{t('title')}</h1>
      <VersionsManager projectId={projectId} />
    </PageFrame>
  );
}
