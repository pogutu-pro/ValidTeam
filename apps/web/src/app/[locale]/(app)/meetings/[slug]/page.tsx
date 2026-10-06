import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { WorkspaceRequiredNotice } from '@/components/layout/workspace-required-notice';
import { MeetingDetailsClient } from '@/components/meetings/meeting-details-client';
import { userHasWorkspaceAccess } from '@/lib/auth/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meetings');
  return { title: t('title'), robots: { index: false } };
}

export const dynamic = 'force-dynamic';

export default async function MeetingDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/auth/signin');
  if (!(await userHasWorkspaceAccess(session.user.id))) return <WorkspaceRequiredNotice />;
  return <MeetingDetailsClient slug={slug} />;
}
