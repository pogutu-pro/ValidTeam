/**
 * Best-effort server-side LiveKit room administration for meetings. Every call
 * degrades to a no-op/null when LiveKit is unconfigured or unreachable so the
 * ValidTeam database remains the source of truth for lifecycle state.
 */
import { createLivekitRoomService } from '@/lib/chat/livekit';

/** Identities currently in the room, or null when LiveKit cannot be queried. */
export async function listRoomIdentities(roomName: string): Promise<Set<string> | null> {
  try {
    const service = await createLivekitRoomService();
    if (!service) return null;
    const participants = await service.listParticipants(roomName);
    return new Set(participants.map((p) => p.identity));
  } catch {
    return null;
  }
}

export async function deleteRoomQuietly(roomName: string): Promise<void> {
  try {
    const service = await createLivekitRoomService();
    await service?.deleteRoom(roomName);
  } catch {
    /* room may already be gone */
  }
}

export async function removeParticipantQuietly(roomName: string, identity: string): Promise<void> {
  try {
    const service = await createLivekitRoomService();
    await service?.removeParticipant(roomName, identity);
  } catch {
    /* participant may already be gone */
  }
}
