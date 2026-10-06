import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { WorkspaceRequiredNotice } from '@/components/layout/workspace-required-notice';
import { MeetingsAnalyticsClient } from '@/components/meetings/meetings-analytics-client';
import { userHasWorkspaceAccess } from '@/lib/auth/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meetings.analyticsPage');
  return { title: t('title'), description: t('subtitle') };
}

export const dynamic = 'force-dynamic';

export default async function MeetingsAnalyticsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth/signin');
  if (!(await userHasWorkspaceAccess(session.user.id))) return <WorkspaceRequiredNotice />;
  return <MeetingsAnalyticsClient />;
}
