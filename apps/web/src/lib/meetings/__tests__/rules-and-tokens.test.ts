/** @jest-environment node */
import {
  isInvitationDue,
  isNoShowDue,
  isReminderDue,
  isSummaryDue,
  neverStartedDeadline,
  type NotifiableMeeting,
} from '../notification-rules';
import {
  buildMeetingIdentity,
  buildMeetingRoomName,
  grantForRole,
  isMeetingRoomName,
  parseMeetingIdentity,
  tokenTtlSeconds,
} from '../livekit';
import { generateGuestToken, hashGuestToken, looksLikeGuestToken } from '../guest-tokens';

const start = new Date('2026-10-07T10:00:00Z');
const at = (min: number) => new Date(start.getTime() + min * 60_000);
const meeting = (over: Partial<NotifiableMeeting> = {}): NotifiableMeeting => ({
  status: 'scheduled',
  isInstant: false,
  scheduledStartAt: start,
  endedAt: null,
  ...over,
});

describe('notification windows', () => {
  it('reminder fires from T-30m until the start, once', () => {
    expect(isReminderDue(meeting(), at(-31))).toBe(false);
    expect(isReminderDue(meeting(), at(-30))).toBe(true);
    expect(isReminderDue(meeting(), at(-1))).toBe(true);
    expect(isReminderDue(meeting(), at(0))).toBe(false);
    expect(isReminderDue(meeting({ isInstant: true }), at(-10))).toBe(false);
    expect(isReminderDue(meeting({ status: 'cancelled' }), at(-10))).toBe(false);
  });

  it('no-show fires from T+30m for open meetings only', () => {
    expect(isNoShowDue(meeting(), at(29))).toBe(false);
    expect(isNoShowDue(meeting(), at(30))).toBe(true);
    expect(isNoShowDue(meeting({ status: 'live' }), at(45))).toBe(true);
    expect(isNoShowDue(meeting({ status: 'ended', endedAt: at(20) }), at(31))).toBe(false);
    expect(isNoShowDue(meeting({ status: 'cancelled' }), at(31))).toBe(false);
    expect(isNoShowDue(meeting(), at(60 * 4))).toBe(false); // stale
    expect(isNoShowDue(meeting({ isInstant: true }), at(31))).toBe(false);
  });

  it('summary requires an ended meeting with attendance, within 24h', () => {
    const ended = meeting({ status: 'ended', endedAt: at(60), hadAttendance: true });
    expect(isSummaryDue(ended, at(61))).toBe(true);
    expect(isSummaryDue({ ...ended, hadAttendance: false }, at(61))).toBe(false);
    expect(isSummaryDue(ended, at(60 + 25 * 60))).toBe(false);
    expect(isSummaryDue(meeting(), at(61))).toBe(false);
  });

  it('invitation is not due for cancelled/ended meetings', () => {
    expect(isInvitationDue(meeting(), at(-1000))).toBe(true);
    expect(isInvitationDue(meeting({ status: 'cancelled' }), at(-1000))).toBe(false);
  });

  it('never-started deadline leaves room for the 30-minute no-show window', () => {
    const d = neverStartedDeadline({ scheduledStartAt: start, scheduledEndAt: at(15) });
    expect(d.getTime()).toBeGreaterThan(at(30).getTime());
  });
});

describe('LiveKit roles and rooms', () => {
  it('only hosts are room admins; everyone can publish and use data channels', () => {
    expect(grantForRole('vm-x', 'host').roomAdmin).toBe(true);
    for (const role of ['participant', 'guest'] as const) {
      const g = grantForRole('vm-x', role);
      expect(g.roomAdmin).toBe(false);
      expect(g).toMatchObject({
        room: 'vm-x',
        roomJoin: true,
        canPublish: true,
        canPublishData: true,
      });
    }
  });

  it('meeting rooms are namespaced apart from chat call rooms', () => {
    expect(isMeetingRoomName(buildMeetingRoomName())).toBe(true);
    expect(isMeetingRoomName('tn-proj-room-abc')).toBe(false);
  });

  it('round-trips identities and rejects foreign ones', () => {
    const id = buildMeetingIdentity('p123', 'sess_abcdefgh');
    expect(parseMeetingIdentity(id)).toEqual({
      participantId: 'p123',
      clientSessionId: 'sess_abcdefgh',
    });
    expect(parseMeetingIdentity('tnp:user:session')).toBeNull();
    expect(parseMeetingIdentity('vm:p1:')).toBeNull();
  });

  it('bounds token TTL', () => {
    const now = new Date();
    expect(tokenTtlSeconds(new Date(now.getTime() + 30_000), now)).toBe(600);
    expect(tokenTtlSeconds(new Date(now.getTime() + 48 * 3600_000), now)).toBe(6 * 3600);
  });
});

describe('guest tokens', () => {
  it('stores only a hash and verifies by re-hashing', () => {
    const { token, tokenHash } = generateGuestToken();
    expect(looksLikeGuestToken(token)).toBe(true);
    expect(tokenHash).not.toContain(token);
    expect(hashGuestToken(token)).toBe(tokenHash);
    expect(generateGuestToken().token).not.toBe(token);
  });
  it('rejects malformed tokens before any lookup', () => {
    expect(looksLikeGuestToken('short')).toBe(false);
    expect(looksLikeGuestToken(undefined)).toBe(false);
  });
});
