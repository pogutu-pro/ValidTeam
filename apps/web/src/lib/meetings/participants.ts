/**
 * Invitee resolution shared by creation, series materialisation and the
 * participants API. Internal users must be ACTIVE members of the meeting's
 * organization; anything else is treated as an external guest by email.
 */
import { db, organizationMembers, users, and, eq, inArray } from '@validteam/db';
import { MeetingError } from './errors';

export const MAX_PARTICIPANTS_PER_MEETING = 200;

export interface GuestInput {
  email: string;
  name?: string | undefined;
}

export interface ResolvedInvitees {
  userIds: string[];
  guests: Array<{ email: string; name: string | null }>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function activeMemberIds(
  organizationId: string,
  userIds: string[]
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ id: users.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'active'),
        eq(users.status, 'active'),
        inArray(organizationMembers.userId, userIds)
      )
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * - rejects internal ids that are not active members of the organization
 * - converts a guest email that belongs to an active member into that member
 * - de-duplicates by user id / lower-cased email
 */
export async function resolveInvitees(input: {
  organizationId: string;
  userIds: string[];
  guests: GuestInput[];
  allowGuests: boolean;
  excludeUserIds?: string[];
}): Promise<ResolvedInvitees> {
  const exclude = new Set(input.excludeUserIds ?? []);
  const requestedIds = [...new Set(input.userIds)];
  const valid = await activeMemberIds(input.organizationId, requestedIds);
  const invalid = requestedIds.filter((id) => !valid.has(id));
  if (invalid.length) {
    throw new MeetingError(
      'invalid_participants',
      400,
      'Some participants are not members of this organization',
      {
        userIds: invalid,
      }
    );
  }

  const guestMap = new Map<string, string | null>();
  for (const g of input.guests) {
    const email = normalizeEmail(g.email);
    if (!guestMap.has(email)) guestMap.set(email, g.name?.trim() || null);
  }

  const memberByEmail = new Map<string, string>();
  if (guestMap.size) {
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.status, 'active'),
          eq(users.status, 'active'),
          inArray(users.email, [...guestMap.keys()])
        )
      );
    for (const r of rows) memberByEmail.set(normalizeEmail(r.email), r.id);
  }

  const userIdSet = new Set(requestedIds);
  const guests: ResolvedInvitees['guests'] = [];
  for (const [email, name] of guestMap) {
    const memberId = memberByEmail.get(email);
    if (memberId) userIdSet.add(memberId);
    else guests.push({ email, name });
  }
  if (guests.length && !input.allowGuests) {
    throw new MeetingError(
      'guests_not_allowed',
      400,
      'External guests are not allowed for this meeting'
    );
  }

  const userIds = [...userIdSet].filter((id) => !exclude.has(id));
  if (userIds.length + guests.length + 1 > MAX_PARTICIPANTS_PER_MEETING) {
    throw new MeetingError(
      'too_many_participants',
      400,
      `At most ${MAX_PARTICIPANTS_PER_MEETING} participants`
    );
  }
  return { userIds, guests };
}
