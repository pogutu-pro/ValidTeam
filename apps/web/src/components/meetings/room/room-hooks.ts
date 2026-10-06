'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Participant } from 'livekit-client';
import {
  useLocalParticipant,
  useParticipantAttributes,
  useRoomContext,
} from '@livekit/components-react';

/** Raise-hand state lives in participant attributes (`hand` = '1'), synced by LiveKit. */
export function useRaisedHand(participant: Participant | undefined): boolean {
  const { attributes } = useParticipantAttributes({ participant });
  return attributes?.hand === '1';
}

export function useToggleHand() {
  const { localParticipant } = useLocalParticipant();
  const raised = useRaisedHand(localParticipant);
  const toggle = useCallback(() => {
    void localParticipant.setAttributes({ hand: raised ? '' : '1' }).catch(() => undefined);
  }, [localParticipant, raised]);
  return { raised, toggle };
}

/** While a meeting is open the surface is dark (like every major meeting product). */
export function useMeetingDarkTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const added = !root.classList.contains('dark');
    if (added) root.classList.add('dark');
    return () => {
      if (added) root.classList.remove('dark');
    };
  }, []);
}

/** mm:ss (or h:mm:ss) since the hook mounted. */
export function useElapsed(): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, []);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Identity of whoever spoke last (sticky, so the spotlight does not flicker). */
export function useActiveSpeakerIdentity(): string | null {
  const room = useRoomContext();
  const [identity, setIdentity] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  useEffect(() => {
    const onChange = (speakers: Participant[]) => {
      const next = speakers.find((s) => !s.isLocal)?.identity ?? speakers[0]?.identity ?? null;
      if (next && next !== latest.current) {
        latest.current = next;
        setIdentity(next);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onChange);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onChange);
    };
  }, [room]);
  return identity;
}

export function useFullscreen() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  const supported =
    typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen);
  return { active, toggle, supported };
}
