/**
 * Settings → Security → Audit log streaming.
 *
 * Lets workspace admins configure SIEM destinations for audit_logs and run a
 * one-shot connectivity test against each.
 *
 * Page is a server component that does auth/perm gating; the actual list/
 * editor is the client component below.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTranslations } from 'next-intl/server';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { AuditLogStreamingClient } from './audit-log-streaming-client';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';

export async function generateMetadata() {
  const t = await getTranslations('pagesSettings');
  return { title: t('auditStreaming.metaTitle') };
}
export const dynamic = 'force-dynamic';

export default async function AuditLogStreamingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/security/audit-log-streaming');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  const t = await getTranslations('pagesSettings');

  return (
    <PageFrame contentClassName="max-w-5xl">
      <PageHeader title={t('auditStreaming.title')} description={t('auditStreaming.subtitle')} />
      <AuditLogStreamingClient organizationId={organizationId} />
    </PageFrame>
  );
}
