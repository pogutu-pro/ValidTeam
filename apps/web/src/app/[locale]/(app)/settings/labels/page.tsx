/**
 * Org-level labels page — members manage the first-class labels used to
 * categorize issues. Mirrors the standalone settings pages (integrations/sso).
 *
 * Permission: active org membership is enough — the labels API
 * (`/api/labels`) gates every call on `isActiveOrganizationMember`.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTranslations } from 'next-intl/server';
import { LabelsSettingsClient } from '@/components/settings/labels-settings-client';
import { listActiveOrganizationMemberships } from '@/lib/auth/access-control';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('labels.metaTitle') };
}

export default async function LabelsSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/labels');
  }

  const [membership] = await listActiveOrganizationMemberships(session.user.id);

  if (!membership) {
    redirect('/dashboard?error=insufficient-permission');
  }

  return <LabelsSettingsClient />;
}
