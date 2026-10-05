/**
 * Just-in-time SAML user provisioning.
 *
 * After a SAML response is verified and attributes resolved, this module
 * ensures we have a ValidTeam user + organization membership for the
 * incoming subject. It is also reused by SCIM `POST /Users`.
 */
import {
  db,
  users,
  organizations,
  organizationMembers,
  systemAuditLogs,
  eq,
  and,
  ne,
} from '@validteam/db';

export type JitProvisionErrorCode = 'workspace_unavailable' | 'user_inactive' | 'provision_failed';

export class JitProvisionError extends Error {
  constructor(
    public readonly code: JitProvisionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'JitProvisionError';
  }
}

export type JitInput = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  workspaceId: string;
  /**
   * If the IdP sends groups in the assertion we record them on the user
   * settings blob — full group→role mapping is out of scope for the
   * scaffolding milestone but the data is preserved.
   */
  groups?: string[];
  audit?: { tokenId: string };
};

export type JitResult = {
  userId: string;
  created: boolean;
  membershipCreated: boolean;
};

function displayName(input: JitInput): string {
  const parts = [input.firstName, input.lastName].filter((s): s is string => !!s && s.length > 0);
  if (parts.length) return parts.join(' ');
  return input.email.split('@')[0] ?? input.email;
}

/**
 * Find or create a user by email, and ensure they are a member of the given
 * workspace. Returns the resolved user id plus boolean flags so callers can
 * audit-log appropriately.
 */
export async function jitProvisionUser(input: JitInput): Promise<JitResult> {
  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    // Keep the organization in a usable state for the full provisioning
    // transaction. A concurrent suspension waits for this shared row lock.
    const [workspace] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, input.workspaceId), ne(organizations.status, 'suspended')))
      .limit(1)
      .for('share');
    if (!workspace) {
      throw new JitProvisionError('workspace_unavailable', 'Workspace is unavailable');
    }

    // Insert first with conflict protection. If another IdP request created
    // the same email concurrently, re-read that canonical row in this
    // transaction instead of surfacing a unique-constraint error.
    const insertedRows = await tx
      .insert(users)
      .values({
        email,
        name: displayName(input),
        emailVerified: new Date(),
        status: 'active',
        settings: input.groups?.length
          ? ({ ssoGroups: input.groups } as Record<string, unknown>)
          : {},
      })
      .onConflictDoNothing()
      .returning({ id: users.id });

    const inserted = insertedRows[0];
    const existing = inserted
      ? null
      : await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (!inserted && !existing) {
      throw new JitProvisionError('provision_failed', 'Failed to provision user');
    }
    if (existing?.status === 'inactive') {
      throw new JitProvisionError('user_inactive', 'User is inactive');
    }

    const userId = inserted?.id ?? existing!.id;
    const created = Boolean(inserted);

    // An invited account may complete activation through a verified
    // enterprise identity. A platform-deactivated account is rejected above.
    if (existing && (!existing.name || existing.status === 'invited')) {
      await tx
        .update(users)
        .set({
          ...(!existing.name ? { name: displayName(input) } : {}),
          ...(existing.status === 'invited'
            ? { status: 'active' as const, emailVerified: new Date() }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
    }

    const insertedMemberships = await tx
      .insert(organizationMembers)
      .values({
        userId,
        organizationId: input.workspaceId,
        role: 'member',
        status: 'active',
      })
      .onConflictDoNothing()
      .returning({ id: organizationMembers.id });
    const membershipCreated = insertedMemberships.length > 0;

    if (!membershipCreated) {
      await tx
        .update(organizationMembers)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.organizationId, input.workspaceId)
          )
        );
    }

    if (input.audit) {
      await tx.insert(systemAuditLogs).values({
        userId: `scim:${input.audit.tokenId}`,
        action: 'scim.user.provisioned',
        resourceType: 'user',
        resourceId: userId,
        organizationId: input.workspaceId,
        changes: {
          created: { from: false, to: created },
          membershipCreated: { from: false, to: membershipCreated },
          active: { from: null, to: true },
        },
        metadata: { actorType: 'scim_token', tokenId: input.audit.tokenId },
      });
    }

    return { userId, created, membershipCreated };
  });
}
