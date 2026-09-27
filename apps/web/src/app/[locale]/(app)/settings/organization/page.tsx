import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';

export default async function OrganizationRedirectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/organization');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'org:settings');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  redirect('/settings?tab=organization');
}
