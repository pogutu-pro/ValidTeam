import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import {
  db,
  users,
  organizationMembers,
  auditLogs,
  projectMembers,
  projects,
  teamMembers,
  teams,
} from '@tasknebula/db';
import { eq, and, inArray, ne, sql } from 'drizzle-orm';
import { hasPermission } from '@/lib/auth/permissions';
import { createId } from '@paralleldrive/cuid2';
import { publishEvent } from '@/lib/realtime/events';

// PATCH /api/organizations/[organizationId]/members/[memberId] - Update member role
const updateMemberSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer', 'guest']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string; memberId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId, memberId } = await params;

    // Check permission
    const canUpdate = await hasPermission(organizationId, 'member:manage');
    if (!canUpdate) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const data = updateMemberSchema.parse(body);

    // Prevent changing own role
    if (memberId === session.user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`organization-member-governance:${organizationId}`}))`
      );
      const [currentMember] = await tx
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, memberId)
          )
        )
        .limit(1)
        .for('update');
      if (!currentMember) return null;

      if (currentMember.role === 'owner' && data.role !== 'owner') {
        const [otherActiveOwner] = await tx
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.role, 'owner'),
              eq(organizationMembers.status, 'active'),
              eq(users.status, 'active'),
              ne(organizationMembers.userId, memberId)
            )
          )
          .limit(1);
        if (!otherActiveOwner) throw new Error('last_organization_owner');
      }

      const [updatedMember] = await tx
        .update(organizationMembers)
        .set({ role: data.role, updatedAt: new Date() })
        .where(eq(organizationMembers.id, currentMember.id))
        .returning();
      if (!updatedMember) throw new Error('member_update_failed');

      await tx.insert(auditLogs).values({
        id: createId(),
        organizationId,
        userId: session.user.id,
        action: 'organization.role_changed',
        resourceType: 'organization_member',
        resourceId: updatedMember.id,
        metadata: { memberId, oldRole: currentMember.role, newRole: data.role },
      });
      const [user] = await tx.select().from(users).where(eq(users.id, memberId)).limit(1);
      return { updatedMember, user };
    });

    if (!result) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const { updatedMember, user } = result;

    if (!user) {
      throw new Error('User not found');
    }

    publishEvent('member.updated', session.user.id, { organizationId });

    return NextResponse.json({
      member: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        status: user.status,
        role: updatedMember.role,
        memberStatus: updatedMember.status,
        joinedAt: updatedMember.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'last_organization_owner') {
      return NextResponse.json({ error: 'Cannot demote the last active owner' }, { status: 409 });
    }

    console.error('Error updating member:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

// DELETE /api/organizations/[organizationId]/members/[memberId] - Remove member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string; memberId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { organizationId, memberId } = await params;

    // Check permission
    const canRemove = await hasPermission(organizationId, 'member:remove');
    if (!canRemove) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Prevent removing self
    if (memberId === session.user.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    const removed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`organization-member-governance:${organizationId}`}))`
      );
      const [member] = await tx
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, memberId)
          )
        )
        .limit(1)
        .for('update');
      if (!member) return null;
      if (member.role === 'owner') throw new Error('organization_owner_remove');

      const projectRows = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));
      const teamRows = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.organizationId, organizationId));
      const projectIds = projectRows.map((project) => project.id);
      const teamIds = teamRows.map((team) => team.id);
      let removedProjectMemberships = 0;
      let removedTeamMemberships = 0;
      if (projectIds.length > 0) {
        const deletedProjectMemberships = await tx
          .delete(projectMembers)
          .where(
            and(eq(projectMembers.userId, memberId), inArray(projectMembers.projectId, projectIds))
          )
          .returning({ id: projectMembers.id });
        removedProjectMemberships = deletedProjectMemberships.length;
      }
      if (teamIds.length > 0) {
        const deletedTeamMemberships = await tx
          .delete(teamMembers)
          .where(and(eq(teamMembers.userId, memberId), inArray(teamMembers.teamId, teamIds)))
          .returning({ id: teamMembers.id });
        removedTeamMemberships = deletedTeamMemberships.length;
      }
      await tx.delete(organizationMembers).where(eq(organizationMembers.id, member.id));

      if (member.status === 'invited') {
        const [remainingInvite] = await tx
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .where(
            and(eq(organizationMembers.userId, memberId), eq(organizationMembers.status, 'invited'))
          )
          .limit(1);
        if (!remainingInvite) {
          await tx
            .update(users)
            .set({ inviteTokenHash: null, inviteTokenExpiresAt: null, updatedAt: new Date() })
            .where(eq(users.id, memberId));
        }
      }

      await tx.insert(auditLogs).values({
        id: createId(),
        organizationId,
        userId: session.user.id,
        action: 'organization.member_removed',
        resourceType: 'organization_member',
        resourceId: member.id,
        metadata: {
          memberId,
          role: member.role,
          cancelledInvite: member.status === 'invited',
          removedProjectMemberships,
          removedTeamMemberships,
        },
      });
      return member;
    });

    if (!removed) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    publishEvent('member.removed', session.user.id, { organizationId });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'organization_owner_remove') {
      return NextResponse.json({ error: 'Cannot remove organization owner' }, { status: 409 });
    }
    console.error('Error removing member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
