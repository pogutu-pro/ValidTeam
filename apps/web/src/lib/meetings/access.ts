/**
 * Meeting authorization. Two principal types:
 *  - member: an authenticated ValidTeam user who is an ACTIVE member of the
 *    meeting's organization (verified here, never trusted from the client)
 *  - guest:  an external invitee holding a valid, unexpired, unrevoked token
 *
 * Callers should answer 404 (not 403) when no principal resolves, so the
 * existence of meetings in other organizations is never revealed.
 */
import {
  db,
  meetings,
  meetingParticipants,
  meetingGuestTokens,
  and,
  eq,
  isNull,
  gt,
  type Meeting,
  type MeetingParticipant,
} from '@validteam/db';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';
import { MeetingError } from './errors';
import { hashGuestToken, looksLikeGuestToken } from './guest-tokens';

const MANAGER_ROLES = new Set(['owner', 'admin']);
const NON_JOINING_ROLES = new Set(['viewer', 'guest']);

export interface MemberPrincipal {
  kind: 'member';
  userId: string;
  orgRole: string | null;
  isHost: boolean;
  /** Host or organization owner/admin: may edit, cancel, end and manage people. */
  canManage: boolean;
  participant: MeetingParticipant | null;
  canJoin: boolean;
}

export interface GuestPrincipal {
  kind: 'guest';
  participant: MeetingParticipant;
}

export type MeetingPrincipal = MemberPrincipal | GuestPrincipal;

export async function resolveMemberPrincipal(
  userId: string,
  meeting: Meeting,
  opts: { apiKeyOrganizationId?: string | null } = {}
): Promise<MemberPrincipal | null> {
  if (opts.apiKeyOrganizationId && opts.apiKeyOrganizationId !== meeting.organizationId)
    return null;

  // Super admins get no implicit access to private meeting rooms.
  const access = await resolveOrganizationAccess(userId, meeting.organizationId, {
    allowSuperAdmin: false,
  });
  if (!access.allowed) return null;

  const [participant] = await db
    .select()
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.organizationId, meeting.organizationId),
        eq(meetingParticipants.userId, userId)
      )
    )
    .limit(1);
  const activeParticipant = participant && !participant.removedAt ? participant : null;
  const isHost = meeting.hostId === userId;
  const canManage = isHost || MANAGER_ROLES.has(access.role ?? '');
  const orgOpen = meeting.access === 'organization' && !NON_JOINING_ROLES.has(access.role ?? '');
  const canView = Boolean(activeParticipant) || canManage || orgOpen;
  if (!canView) return null;

  return {
    kind: 'member',
    userId,
    orgRole: access.role,
    isHost,
    canManage,
    participant: activeParticipant,
    // A removed participant stays removed even in an organization-open meeting.
    canJoin: !participant?.removedAt && (isHost || Boolean(activeParticipant) || orgOpen),
  };
}

/** Organization-open meetings: create the attendee row on first join. */
export async function ensureMemberParticipant(
  meeting: Meeting,
  principal: MemberPrincipal
): Promise<MeetingParticipant> {
  if (principal.participant) return principal.participant;
  await db
    .insert(meetingParticipants)
    .values({
      meetingId: meeting.id,
      organizationId: meeting.organizationId,
      userId: principal.userId,
      role: meeting.hostId === principal.userId ? 'host' : 'participant',
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meeting.id),
        eq(meetingParticipants.userId, principal.userId)
      )
    )
    .limit(1);
  if (!row || row.removedAt)
    throw new MeetingError('forbidden', 403, 'You cannot join this meeting');
  return row;
}

/**
 * Validate a guest token for a specific meeting slug. All failure modes return
 * the same error so a probing client learns nothing about which check failed.
 */
export async function resolveGuestPrincipal(
  slug: string,
  token: unknown
): Promise<{ meeting: Meeting; principal: GuestPrincipal }> {
  const deny = () => new MeetingError('invalid_guest_link', 403, 'This guest link is not valid');
  if (!looksLikeGuestToken(token)) throw deny();

  const now = new Date();
  const [row] = await db
    .select({ meeting: meetings, participant: meetingParticipants, tokenId: meetingGuestTokens.id })
    .from(meetingGuestTokens)
    .innerJoin(meetingParticipants, eq(meetingParticipants.id, meetingGuestTokens.participantId))
    .innerJoin(meetings, eq(meetings.id, meetingGuestTokens.meetingId))
    .where(
      and(
        eq(meetingGuestTokens.tokenHash, hashGuestToken(token)),
        eq(meetings.slug, slug),
        isNull(meetingGuestTokens.revokedAt),
        gt(meetingGuestTokens.expiresAt, now),
        isNull(meetingParticipants.removedAt)
      )
    )
    .limit(1);

  if (!row || row.participant.guestEmail === null || !row.meeting.allowGuests) throw deny();
  void db
    .update(meetingGuestTokens)
    .set({ lastUsedAt: now })
    .where(eq(meetingGuestTokens.id, row.tokenId))
    .catch(() => {});
  return { meeting: row.meeting, principal: { kind: 'guest', participant: row.participant } };
}
