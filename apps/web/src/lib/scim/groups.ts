/**
 * SCIM 2.0 Group helpers — backed by the existing `teams` + `team_members`
 * tables. Each team in a workspace is exposed as one SCIM Group.
 *
 * The mapping is intentionally minimal: SCIM `displayName` ↔ `teams.name`,
 * SCIM `members[].value` ↔ `team_members.userId`. Group descriptions /
 * external metadata are left untouched.
 */
import {
  db,
  teams,
  teamMembers,
  organizationMembers,
  organizations,
  systemAuditLogs,
  users,
  eq,
  and,
  inArray,
  ne,
  sql,
} from '@validteam/db';
import { createId } from '@paralleldrive/cuid2';
import { SCIM_SCHEMAS, type ScimGroupRecord } from './types';
import { getBaseUrl } from '../sso/saml';

export type WorkspaceGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

type ScimDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ScimGroupMutationErrorCode =
  | 'workspace_unavailable'
  | 'group_not_found'
  | 'invalid_display_name'
  | 'invalid_members';

export class ScimGroupMutationError extends Error {
  constructor(public readonly code: ScimGroupMutationErrorCode) {
    super(code);
    this.name = 'ScimGroupMutationError';
  }
}

async function teamsForWorkspace(workspaceId: string) {
  return db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.organizationId, workspaceId));
}

async function membersFor(teamIds: string[]) {
  if (!teamIds.length) return [] as { teamId: string; userId: string }[];
  return db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds));
}

export async function listWorkspaceGroups(
  workspaceId: string,
  options: { startIndex: number; count: number }
): Promise<{ rows: WorkspaceGroup[]; total: number }> {
  const allTeams = await teamsForWorkspace(workspaceId);
  const ids = allTeams.map((t) => t.id);
  const allMembers = await membersFor(ids);
  const memberMap = new Map<string, string[]>();
  for (const m of allMembers) {
    const list = memberMap.get(m.teamId) ?? [];
    list.push(m.userId);
    memberMap.set(m.teamId, list);
  }
  const rows = allTeams.map<WorkspaceGroup>((t) => ({
    id: t.id,
    name: t.name,
    memberIds: memberMap.get(t.id) ?? [],
  }));
  const startIndex = Math.max(1, options.startIndex);
  const count = Math.min(200, Math.max(0, options.count));
  return {
    total: rows.length,
    rows: rows.slice(startIndex - 1, startIndex - 1 + count),
  };
}

export async function getWorkspaceGroup(
  workspaceId: string,
  groupId: string,
  executor: ScimDbExecutor = db,
  lockForUpdate = false
): Promise<WorkspaceGroup | null> {
  const query = executor
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, groupId), eq(teams.organizationId, workspaceId)))
    .limit(1);
  const [team] = lockForUpdate ? await query.for('update') : await query;
  if (!team) return null;
  const members = await executor
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, team.id));
  return {
    id: team.id,
    name: team.name,
    memberIds: members.map((m) => m.userId),
  };
}

export function toScimGroup(row: WorkspaceGroup): ScimGroupRecord {
  return {
    schemas: [SCIM_SCHEMAS.group],
    id: row.id,
    displayName: row.name,
    members: row.memberIds.map((id) => ({ value: id, type: 'User' })),
    meta: {
      resourceType: 'Group',
      location: `${getBaseUrl()}/api/scim/v2/Groups/${row.id}`,
    },
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'team'
  );
}

export async function createWorkspaceGroup(
  workspaceId: string,
  displayName: string,
  memberIds: string[],
  tokenId?: string
): Promise<WorkspaceGroup> {
  return db.transaction(async (tx) => {
    const name = normalizeDisplayName(displayName);
    const [workspace] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, workspaceId), ne(organizations.status, 'suspended')))
      .limit(1)
      .for('share');
    if (!workspace) throw new ScimGroupMutationError('workspace_unavailable');

    const id = createId();
    const [team] = await tx
      .insert(teams)
      .values({
        id,
        organizationId: workspaceId,
        name,
        slug: `${slugify(name)}-${id.slice(-10)}`.slice(0, 100),
      })
      .returning({ id: teams.id, name: teams.name });
    if (!team) throw new ScimGroupMutationError('group_not_found');

    await applyGroupMembershipChangesWithExecutor(workspaceId, team.id, { replace: memberIds }, tx);
    if (tokenId) {
      await writeGroupAudit(tx, {
        tokenId,
        workspaceId,
        groupId: team.id,
        action: 'scim.group.created',
        changes: {
          displayName: { from: null, to: name },
          memberCount: { from: 0, to: new Set(memberIds).size },
        },
      });
    }

    const created = await getWorkspaceGroup(workspaceId, team.id, tx);
    if (!created) throw new ScimGroupMutationError('group_not_found');
    return created;
  });
}

function normalizeDisplayName(displayName: string): string {
  const name = displayName.trim();
  if (name.length === 0 || name.length > 255) {
    throw new ScimGroupMutationError('invalid_display_name');
  }
  return name;
}

function normalizeMemberIds(memberIds: string[]): string[] {
  if (memberIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    throw new ScimGroupMutationError('invalid_members');
  }
  return Array.from(new Set(memberIds.map((id) => id.trim())));
}

async function writeGroupAudit(
  executor: ScimDbExecutor,
  params: {
    tokenId: string;
    workspaceId: string;
    groupId: string;
    action: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }
) {
  await executor.insert(systemAuditLogs).values({
    userId: `scim:${params.tokenId}`,
    action: params.action,
    resourceType: 'team',
    resourceId: params.groupId,
    organizationId: params.workspaceId,
    changes: params.changes,
    metadata: { actorType: 'scim_token', tokenId: params.tokenId },
  });
}

export async function updateWorkspaceGroupAtomic(params: {
  workspaceId: string;
  groupId: string;
  tokenId: string;
  displayName?: string;
  members: { add?: string[]; remove?: string[]; replace?: string[] };
}): Promise<WorkspaceGroup> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`scim-group:${params.groupId}`}))`
    );
    const current = await getWorkspaceGroup(params.workspaceId, params.groupId, tx, true);
    if (!current) throw new ScimGroupMutationError('group_not_found');

    const nextName =
      params.displayName !== undefined ? normalizeDisplayName(params.displayName) : current.name;
    await applyGroupMembershipChangesWithExecutor(
      params.workspaceId,
      params.groupId,
      params.members,
      tx
    );
    if (nextName !== current.name) {
      await renameWorkspaceGroup(params.workspaceId, params.groupId, nextName, tx);
    }

    const updated = await getWorkspaceGroup(params.workspaceId, params.groupId, tx);
    if (!updated) throw new ScimGroupMutationError('group_not_found');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (nextName !== current.name) {
      changes.displayName = { from: current.name, to: nextName };
    }
    if (
      params.members.replace !== undefined ||
      (params.members.add?.length ?? 0) > 0 ||
      (params.members.remove?.length ?? 0) > 0
    ) {
      changes.memberCount = { from: current.memberIds.length, to: updated.memberIds.length };
    }
    if (Object.keys(changes).length > 0) {
      await writeGroupAudit(tx, {
        tokenId: params.tokenId,
        workspaceId: params.workspaceId,
        groupId: params.groupId,
        action: 'scim.group.updated',
        changes,
      });
    }
    return updated;
  });
}

export async function deleteWorkspaceGroupAtomic(params: {
  workspaceId: string;
  groupId: string;
  tokenId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`scim-group:${params.groupId}`}))`
    );
    const current = await getWorkspaceGroup(params.workspaceId, params.groupId, tx, true);
    if (!current) throw new ScimGroupMutationError('group_not_found');
    await tx
      .delete(teams)
      .where(and(eq(teams.id, params.groupId), eq(teams.organizationId, params.workspaceId)));
    await writeGroupAudit(tx, {
      tokenId: params.tokenId,
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      action: 'scim.group.deleted',
      changes: {
        deleted: { from: false, to: true },
        displayName: { from: current.name, to: null },
        memberCount: { from: current.memberIds.length, to: 0 },
      },
    });
  });
}

async function renameWorkspaceGroup(
  workspaceId: string,
  groupId: string,
  displayName: string,
  executor: ScimDbExecutor = db
): Promise<void> {
  await executor
    .update(teams)
    .set({ name: displayName, updatedAt: new Date() })
    .where(and(eq(teams.id, groupId), eq(teams.organizationId, workspaceId)));
}

/**
 * Apply add / remove / replace membership changes for a group. `add` and
 * `remove` are additive; `replace` overrides any other set in this call.
 *
 * We silently skip member IDs that aren't members of the workspace — this
 * keeps the response well-formed when IdPs over-eagerly include users that
 * haven't been synced yet.
 */
async function applyGroupMembershipChangesWithExecutor(
  workspaceId: string,
  groupId: string,
  changes: { add?: string[]; remove?: string[]; replace?: string[] },
  executor: ScimDbExecutor
): Promise<void> {
  const replace = changes.replace !== undefined ? normalizeMemberIds(changes.replace) : undefined;
  const add = normalizeMemberIds(changes.add ?? []);
  const remove = normalizeMemberIds(changes.remove ?? []);
  const candidate = replace ?? add;
  if (candidate.length === 0 && replace === undefined && remove.length === 0) return;

  // Validate which candidates actually belong to the workspace.
  const validMembers = candidate.length
    ? await executor
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, workspaceId),
            eq(organizationMembers.status, 'active'),
            eq(users.status, 'active'),
            inArray(organizationMembers.userId, candidate)
          )
        )
    : [];
  const validSet = new Set(validMembers.map((r) => r.userId));
  if (validSet.size !== candidate.length) {
    throw new ScimGroupMutationError('invalid_members');
  }

  if (replace !== undefined) {
    await executor.delete(teamMembers).where(eq(teamMembers.teamId, groupId));
    if (replace.length) {
      await executor
        .insert(teamMembers)
        .values(replace.map((userId) => ({ teamId: groupId, userId, role: 'member' as const })))
        .onConflictDoNothing();
    }
    return;
  }
  if (remove.length) {
    await executor
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, groupId), inArray(teamMembers.userId, remove)));
  }
  if (add.length) {
    await executor
      .insert(teamMembers)
      .values(add.map((userId) => ({ teamId: groupId, userId, role: 'member' as const })))
      .onConflictDoNothing();
  }
}
