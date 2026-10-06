'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDataChannel } from '@livekit/components-react';

/**
 * Emoji reactions travel over a LiveKit data channel (topic `reaction`): they
 * are transient and never stored. Only keys from this allowlist are rendered,
 * so a peer cannot inject arbitrary text or markup into other people's rooms.
 */
export const REACTIONS = [
  { key: 'thumbsUp', emoji: '👍' },
  { key: 'clap', emoji: '👏' },
  { key: 'heart', emoji: '❤️' },
  { key: 'laugh', emoji: '😂' },
  { key: 'wow', emoji: '😮' },
  { key: 'party', emoji: '🎉' },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]['key'];

const BY_KEY = new Map<string, string>(REACTIONS.map((r) => [r.key, r.emoji]));
const MAX_ON_SCREEN = 12;
const LIFETIME_MS = 4000;
const MIN_GAP_MS = 150;

export interface ReactionItem {
  id: number;
  emoji: string;
  name: string;
  /** Horizontal jitter so simultaneous reactions do not stack exactly. */
  offset: number;
}

export function parseReaction(payload: Uint8Array): ReactionKey | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as { r?: unknown };
    return typeof parsed.r === 'string' && BY_KEY.has(parsed.r) ? (parsed.r as ReactionKey) : null;
  } catch {
    return null;
  }
}

export function useReactions() {
  const [items, setItems] = useState<ReactionItem[]>([]);
  const nextId = useRef(1);
  const lastSent = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach(clearTimeout);
      live.clear();
    };
  }, []);

  const push = useCallback((key: ReactionKey, name: string) => {
    const emoji = BY_KEY.get(key);
    if (!emoji) return;
    const id = nextId.current++;
    setItems((prev) => [
      ...prev.slice(-(MAX_ON_SCREEN - 1)),
      { id, emoji, name, offset: (id * 37) % 48 },
    ]);
    const t = setTimeout(() => {
      timers.current.delete(t);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, LIFETIME_MS);
    timers.current.add(t);
  }, []);

  const { send } = useDataChannel('reaction', (msg) => {
    const key = parseReaction(msg.payload);
    if (key) push(key, msg.from?.name || msg.from?.identity || '');
  });

  const sendReaction = useCallback(
    (key: ReactionKey, selfLabel: string) => {
      const now = Date.now();
      if (now - lastSent.current < MIN_GAP_MS) return;
      lastSent.current = now;
      push(key, selfLabel);
      void send(new TextEncoder().encode(JSON.stringify({ r: key })), { reliable: false });
    },
    [push, send]
  );

  return { items, sendReaction };
}

export function ReactionOverlay({ items }: { items: ReactionItem[] }) {
  return (
    <div
      data-testid="reaction-overlay"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-72 overflow-hidden"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="meeting-reaction absolute bottom-4 flex flex-col items-center"
          style={{ insetInlineStart: `${12 + item.offset}px` }}
        >
          <span className="text-4xl leading-none drop-shadow">{item.emoji}</span>
          {item.name ? (
            <span className="mt-1 max-w-24 truncate rounded-sm bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
              {item.name}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ReactionButtons({ onPick }: { onPick: (key: ReactionKey) => void }) {
  const t = useTranslations('meetings.room');
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('reactions')}>
      {REACTIONS.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onPick(r.key)}
          aria-label={t(`reactionLabels.${r.key}`)}
          className="hover:bg-accent focus-visible:ring-ring ease-snap flex h-11 w-11 items-center justify-center rounded-full text-2xl transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2"
        >
          <span aria-hidden="true">{r.emoji}</span>
        </button>
      ))}
    </div>
  );
}
