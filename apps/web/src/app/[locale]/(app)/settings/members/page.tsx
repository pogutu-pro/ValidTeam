import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPermittedOrganizationIds } from '@/lib/auth/permissions';

export default async function MembersRedirectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/settings/members');
  }

  const [organizationId] = await getPermittedOrganizationIds(session.user.id, 'member:view');

  if (!organizationId) {
    redirect('/dashboard?error=insufficient-permission');
  }

  redirect('/settings?tab=members');
}
