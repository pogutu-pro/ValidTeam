import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';
import { AiTransparencyClient } from './ai-transparency-client';
import { PageFrame } from '@/components/ui/page-frame';

export default async function AiTransparencyPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/ai-transparency');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  return (
    <PageFrame contentClassName="max-w-5xl">
      <AiTransparencyClient organizationId={organizationId} />
    </PageFrame>
  );
}
