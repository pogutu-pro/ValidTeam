import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { db, organizationMembers, users as usersTable } from '@validteam/db';
import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { hasPermission } from '@/lib/auth/permissions';
import { TeamPageClient } from './team-page-client';
import type { TeamMemberRow } from './team-members-list';
import { PageFrame } from '@/components/ui/page-frame';
import { PageHeader } from '@/components/ui/page-header';
import { listActiveOrganizationMemberships } from '@/lib/auth/access-control';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pagesWork');
  return {
    title: t('team.metaTitle'),
    description: t('team.metaDescription'),
  };
}

export default async function TeamPage() {
  const [t, tProjects] = await Promise.all([
    getTranslations('pagesWork'),
    getTranslations('pagesProjects'),
  ]);
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/auth/signin');
  }

  const memberships = await listActiveOrganizationMemberships(session.user.id);
  let access:
    | {
        organizationId: string;
        canViewMembers: boolean;
        canViewTeamspaces: boolean;
        canInviteMembers: boolean;
        canManageTeamspaces: boolean;
      }
    | undefined;

  for (const membership of memberships) {
    const [canViewMembers, canViewTeamspaces, canInviteMembers, canManageTeamspaces] =
      await Promise.all([
        hasPermission(membership.organizationId, 'member:view'),
        hasPermission(membership.organizationId, 'team:view'),
        hasPermission(membership.organizationId, 'member:invite'),
        hasPermission(membership.organizationId, 'org:settings'),
      ]);
    if (canViewMembers || canViewTeamspaces) {
      access = {
        organizationId: membership.organizationId,
        canViewMembers,
        canViewTeamspaces,
        canInviteMembers,
        canManageTeamspaces,
      };
      break;
    }
  }

  if (!access) {
    return (
      <PageFrame>
        <PageHeader title={t('team.title')} />
        <div className="surface-card space-y-3 p-8 text-center">
          <Users className="text-muted-foreground mx-auto h-8 w-8" />
          <p className="text-foreground text-sm font-medium">
            {tProjects('projectInviteRequiredTitle')}
          </p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">
            {tProjects('projectInviteRequiredDescription')}
          </p>
        </div>
      </PageFrame>
    );
  }

  const {
    organizationId,
    canViewMembers,
    canViewTeamspaces,
    canInviteMembers,
    canManageTeamspaces,
  } = access;

  const allMembers = canViewMembers
    ? await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.status, 'active')
          )
        )
    : [];

  const userIds = allMembers.map((m) => m.userId);

  const users =
    userIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
      : [];

  const membersWithUsers = allMembers
    .map((member) => {
      const user = users.find((u) => u.id === member.userId);
      return { ...member, user };
    })
    .filter((m) => m.user);

  const plainMembers: TeamMemberRow[] = membersWithUsers.map((m) => ({
    id: m.id,
    role: m.role,
    user: {
      id: m.user!.id,
      name: m.user!.name ?? null,
      email: m.user!.email ?? null,
      image: m.user!.image ?? null,
      status: m.user!.status ?? null,
    },
  }));

  return (
    <TeamPageClient
      organizationId={organizationId}
      canViewMembers={canViewMembers}
      canViewTeamspaces={canViewTeamspaces}
      canInviteMembers={canInviteMembers}
      canManageTeamspaces={canManageTeamspaces}
      initialMembers={plainMembers}
    />
  );
}
