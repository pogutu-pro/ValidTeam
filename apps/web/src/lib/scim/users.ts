/**
 * SCIM 2.0 User helpers — DB lookups + record shaping.
 *
 * Users live in the shared `users` table; SCIM-visible status comes from
 * `organization_members.status` (active vs. inactive) for the workspace the
 * IdP is provisioning into.
 */
import { db, users, organizationMembers, systemAuditLogs, eq, and, ne, sql } from '@tasknebula/db';
import { SCIM_SCHEMAS, type ScimUserRecord } from './types';
import { getBaseUrl } from '../sso/saml';

export type WorkspaceUserRow = {
  id: string;
  email: string;
  name: string | null;
  membership: { status: string };
};

type ScimDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ScimUserMutationErrorCode =
  | 'user_not_found'
  | 'invalid_email'
  | 'email_conflict'
  | 'shared_identity';

export class ScimUserMutationError extends Error {
  constructor(public readonly code: ScimUserMutationErrorCode) {
    super(code);
    this.name = 'ScimUserMutationError';
  }
}

export async function listWorkspaceUsers(
  workspaceId: string,
  options: { startIndex: number; count: number; userName?: string }
): Promise<{ rows: WorkspaceUserRow[]; total: number }> {
  const startIndex = Math.max(1, options.startIndex);
  const count = Math.min(200, Math.max(0, options.count));

  const baseWhere = options.userName
    ? and(
        eq(organizationMembers.organizationId, workspaceId),
        eq(users.email, options.userName.trim().toLowerCase())
      )
    : eq(organizationMembers.organizationId, workspaceId);

  // We don't paginate at the SQL level for the scaffolding pass — workspaces
  // typically have under a few thousand members, and SCIM clients request
  // counts that fit in memory. Slice in JS.
  const allRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(baseWhere);

  const total = allRows.length;
  const pageRows = allRows.slice(startIndex - 1, startIndex - 1 + count);
  return {
    total,
    rows: pageRows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      membership: { status: r.status },
    })),
  };
}

export async function getWorkspaceUser(
  workspaceId: string,
  userId: string,
  executor: ScimDbExecutor = db,
  lockForUpdate = false
): Promise<WorkspaceUserRow | null> {
  const query = executor
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      status: organizationMembers.status,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, workspaceId), eq(users.id, userId)))
    .limit(1);
  const [row] = lockForUpdate ? await query.for('update') : await query;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    membership: { status: row.status },
  };
}

export function toScimUser(row: WorkspaceUserRow): ScimUserRecord {
  const [givenName, ...rest] = (row.name ?? '').split(' ');
  const familyName = rest.join(' ') || null;
  return {
    schemas: [SCIM_SCHEMAS.user],
    id: row.id,
    userName: row.email,
    name: {
      givenName: givenName || null,
      familyName,
      formatted: row.name ?? null,
    },
    displayName: row.name ?? null,
    active: row.membership.status === 'active',
    emails: [{ value: row.email, primary: true, type: 'work' }],
    meta: {
      resourceType: 'User',
      location: `${getBaseUrl()}/api/scim/v2/Users/${row.id}`,
    },
  };
}

/** Tiny `userName eq "x"` filter parser — sufficient for Okta/Entra/Google. */
export function parseUserFilter(filter: string | null): {
  userName?: string;
  supported: boolean;
} {
  if (!filter) return { supported: true };
  const m = /^\s*userName\s+eq\s+["'](.+?)["']\s*$/i.exec(filter);
  if (m) return { userName: m[1], supported: true };
  // externalId — we don't store externalId yet; treat as a userName lookup
  // since Google Workspace tends to set both to the email.
  const m2 = /^\s*externalId\s+eq\s+["'](.+?)["']\s*$/i.exec(filter);
  if (m2) return { userName: m2[1], supported: true };
  return { supported: false };
}

export async function setMembershipStatus(
  workspaceId: string,
  userId: string,
  status: 'active' | 'inactive',
  executor: ScimDbExecutor = db
): Promise<void> {
  await executor
    .update(organizationMembers)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(organizationMembers.organizationId, workspaceId),
        eq(organizationMembers.userId, userId)
      )
    );
}

export async function updateUserCore(
  userId: string,
  patch: { name?: string | null; email?: string },
  executor: ScimDbExecutor = db
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.email) update.email = patch.email.trim().toLowerCase();
  if (Object.keys(update).length === 1) return;
  await executor.update(users).set(update).where(eq(users.id, userId));
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new ScimUserMutationError('invalid_email');
  }
  return normalized;
}

function scimAuditActor(tokenId: string): string {
  return `scim:${tokenId}`;
}

/**
 * Update the global user core and workspace membership as one mutation.
 * Global name/email changes are rejected for identities shared with another
 * workspace because one tenant's IdP must not rewrite another tenant's login.
 */
export async function updateWorkspaceUserAtomic(params: {
  workspaceId: string;
  userId: string;
  tokenId: string;
  patch: { name?: string | null; email?: string };
  membershipStatus?: 'active' | 'inactive';
}): Promise<WorkspaceUserRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`scim-user:${params.userId}`}))`);

    const current = await getWorkspaceUser(params.workspaceId, params.userId, tx, true);
    if (!current) throw new ScimUserMutationError('user_not_found');

    const nextEmail =
      params.patch.email !== undefined ? normalizeEmail(params.patch.email) : current.email;
    const nextName = params.patch.name !== undefined ? params.patch.name : current.name;
    const coreChanges = nextEmail !== current.email || nextName !== current.name;

    if (coreChanges) {
      const memberships = await tx
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, params.userId));
      if (memberships.some((row) => row.organizationId !== params.workspaceId)) {
        throw new ScimUserMutationError('shared_identity');
      }
    }

    if (nextEmail !== current.email) {
      const [conflict] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, nextEmail), ne(users.id, params.userId)))
        .limit(1);
      if (conflict) throw new ScimUserMutationError('email_conflict');
    }

    if (coreChanges) {
      await updateUserCore(
        params.userId,
        {
          ...(nextEmail !== current.email ? { email: nextEmail } : {}),
          ...(nextName !== current.name ? { name: nextName } : {}),
        },
        tx
      );
    }
    const currentStatus = current.membership.status === 'active' ? 'active' : 'inactive';
    if (params.membershipStatus && params.membershipStatus !== currentStatus) {
      await setMembershipStatus(params.workspaceId, params.userId, params.membershipStatus, tx);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (nextEmail !== current.email) changes.email = { from: current.email, to: nextEmail };
    if (nextName !== current.name) changes.name = { from: current.name, to: nextName };
    if (params.membershipStatus && params.membershipStatus !== currentStatus) {
      changes.active = {
        from: currentStatus === 'active',
        to: params.membershipStatus === 'active',
      };
    }

    if (Object.keys(changes).length > 0) {
      await tx.insert(systemAuditLogs).values({
        userId: scimAuditActor(params.tokenId),
        action: 'scim.user.updated',
        resourceType: 'user',
        resourceId: params.userId,
        organizationId: params.workspaceId,
        changes,
        metadata: { actorType: 'scim_token', tokenId: params.tokenId },
      });
    }

    const updated = await getWorkspaceUser(params.workspaceId, params.userId, tx);
    if (!updated) throw new ScimUserMutationError('user_not_found');
    return updated;
  });
}
