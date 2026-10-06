/** Pure layout helpers for the video stage (unit-tested). */

export const MAX_STAGE_TILES = 16;

export interface GridPlan {
  /** Tailwind column classes: base (phone) / sm / lg. */
  className: string;
  visible: number;
  overflow: number;
}

/**
 * 1 -> full stage; 2 -> side by side (stacked on phones); 3-4 -> 2x2;
 * 5-9 -> 3 cols; more -> 4 cols, capped at MAX_STAGE_TILES with an overflow tile.
 */
export function planGrid(count: number): GridPlan {
  const visible = Math.min(count, MAX_STAGE_TILES);
  const overflow = Math.max(0, count - MAX_STAGE_TILES);
  let className: string;
  if (count <= 1) className = 'grid-cols-1';
  else if (count === 2) className = 'grid-cols-1 sm:grid-cols-2';
  else if (count <= 4) className = 'grid-cols-2';
  else if (count <= 9) className = 'grid-cols-2 sm:grid-cols-3';
  else className = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  return { className, visible, overflow };
}

export interface ParticipantMeta {
  participantId: string | null;
  role: 'host' | 'participant' | 'guest' | null;
}

export function parseParticipantMeta(metadata: string | undefined | null): ParticipantMeta {
  try {
    const raw = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};
    const role =
      raw.role === 'host' || raw.role === 'participant' || raw.role === 'guest' ? raw.role : null;
    return {
      participantId: typeof raw.participantId === 'string' ? raw.participantId : null,
      role,
    };
  } catch {
    return { participantId: null, role: null };
  }
}

export function initials(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}
