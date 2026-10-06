/**
 * Meeting-side LiveKit helpers. Reuses the existing server (token helper in
 * lib/chat/livekit); meetings live in the `vm-` room namespace so the webhook
 * can route them away from chat calls (`tn-`). The API secret never leaves
 * the server — browsers only receive a short-lived signed token.
 */
import { createId } from '@paralleldrive/cuid2';
import type { VideoGrant } from 'livekit-server-sdk';

export const MEETING_ROOM_PREFIX = 'vm-';
const IDENTITY_PREFIX = 'vm';

export type MeetingLivekitRole = 'host' | 'participant' | 'guest';

export function buildMeetingRoomName(): string {
  return `${MEETING_ROOM_PREFIX}${createId()}`;
}

export function isMeetingRoomName(name: string | null | undefined): boolean {
  return Boolean(name && name.startsWith(MEETING_ROOM_PREFIX));
}

export function sanitizeClientSessionId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : createId();
}

/** `vm:<participantId>:<clientSessionId>` — one identity per browser tab. */
export function buildMeetingIdentity(participantId: string, clientSessionId: string): string {
  return `${IDENTITY_PREFIX}:${participantId}:${clientSessionId}`;
}

export function parseMeetingIdentity(
  identity: string | null | undefined
): { participantId: string; clientSessionId: string } | null {
  const match = identity?.match(/^vm:([A-Za-z0-9]+):([A-Za-z0-9_-]+)$/);
  return match ? { participantId: match[1]!, clientSessionId: match[2]! } : null;
}

/**
 * Only the host receives room administration. Participants and guests can
 * publish (mic/camera/screen) and use data channels for transient chat.
 */
export function grantForRole(roomName: string, role: MeetingLivekitRole): VideoGrant {
  const base: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Raise-hand state is stored in participant attributes.
    canUpdateOwnMetadata: true,
  };
  return role === 'host' ? { ...base, roomAdmin: true } : { ...base, roomAdmin: false };
}

/** Token lifetime: until the join deadline, bounded to [10 min, 6 h]. */
export function tokenTtlSeconds(deadline: Date, now: Date = new Date()): number {
  const seconds = Math.floor((deadline.getTime() - now.getTime()) / 1000);
  return Math.min(6 * 3600, Math.max(600, seconds));
}
