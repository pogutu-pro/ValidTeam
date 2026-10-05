/**
 * SSO settings page — workspace admins configure SAML IdP trust + manage
 * SCIM provisioning tokens here.
 *
 * Permission: `org:settings` (shared with other organization settings pages).
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db, organizations } from '@validteam/db';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { SsoSettingsClient } from '@/components/settings/sso-settings-client';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('sso.metaTitle') };
}

export default async function SsoSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/sso');
  }
  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');
  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const [organization] = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const t = await getTranslations('pagesSettings');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('sso.title')} description={t('sso.subtitle')} />
      <SsoSettingsClient organizationId={organizationId} organizationSlug={organization.slug} />
    </PageFrame>
  );
}
