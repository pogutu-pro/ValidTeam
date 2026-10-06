'use client';

import { useTranslations } from 'next-intl';
import {
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { MicOff, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActiveSpeakerIdentity, useRaisedHand } from './room-hooks';
import { avatarTone, initials, parseParticipantMeta, planGrid } from './meeting-layout';

export type StageLayout = 'grid' | 'speaker';

export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold',
        avatarTone(name),
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

function Tile({
  trackRef,
  pinned = false,
  onTogglePin,
  compact = false,
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  pinned?: boolean;
  onTogglePin?: ((identity: string) => void) | undefined;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('meetings.room');
  const { participant } = trackRef;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const handRaised = useRaisedHand(participant);
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const name = participant.name || participant.identity;
  const meta = parseParticipantMeta(participant.metadata);

  return (
    <div
      className={cn(
        'bg-muted group relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg',
        speaking && !isScreen ? 'ring-accent-blue ring-2' : 'ring-border ring-1',
        className
      )}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            'h-full w-full',
            isScreen ? 'object-contain' : 'object-cover',
            participant.isLocal && !isScreen && '-scale-x-100'
          )}
        />
      ) : (
        <PersonAvatar
          name={name}
          className={compact ? 'h-10 w-10 text-sm' : 'h-20 w-20 text-2xl sm:h-24 sm:w-24'}
        />
      )}

      {handRaised && !isScreen ? (
        <span
          role="img"
          aria-label={t('handRaised', { name })}
          className="bg-accent-blue absolute start-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-base text-white dark:text-slate-950"
        >
          {'✋'}
        </span>
      ) : null}

      {!isScreen && onTogglePin ? (
        <button
          type="button"
          onClick={() => onTogglePin(participant.identity)}
          aria-label={pinned ? t('unpin', { name }) : t('pin', { name })}
          aria-pressed={pinned}
          className="absolute end-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100"
        >
          {pinned ? (
            <PinOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pin className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}

      <div className="absolute bottom-2 start-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
        {!isScreen && micMuted ? (
          <MicOff className="h-3.5 w-3.5 shrink-0" aria-label={t('micOff')} />
        ) : null}
        <span className="truncate">
          {isScreen ? t('presenting', { name }) : name}
          {participant.isLocal && !isScreen ? ` (${t('you')})` : ''}
        </span>
        {meta.role === 'guest' && !isScreen ? (
          <span className="rounded-sm bg-white/20 px-1 text-[10px] uppercase tracking-wide">
            {t('guest')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const MAX_STRIP = 12;

export function Stage({
  layout,
  pinnedIdentity,
  onTogglePin,
}: {
  layout: StageLayout;
  pinnedIdentity: string | null;
  onTogglePin: (identity: string) => void;
}) {
  const t = useTranslations('meetings.room');
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).filter(
    isTrackReference
  );
  const activeId = useActiveSpeakerIdentity();

  const pinned = pinnedIdentity
    ? cameras.find((c) => c.participant.identity === pinnedIdentity)
    : undefined;
  const speaker =
    layout === 'speaker'
      ? (cameras.find((c) => c.participant.identity === activeId) ??
        cameras.find((c) => !c.participant.isLocal) ??
        cameras[0])
      : undefined;
  const spotlight: TrackReferenceOrPlaceholder | undefined = screens[0] ?? pinned ?? speaker;

  if (spotlight) {
    const strip = cameras
      .filter((c) => c !== spotlight && c.participant.identity !== spotlight.participant.identity)
      .slice(0, MAX_STRIP);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
        <Tile
          trackRef={spotlight}
          pinned={spotlight.participant.identity === pinnedIdentity}
          onTogglePin={onTogglePin}
          className="min-h-0 flex-1"
        />
        {strip.length > 0 || screens[0] ? (
          <div className="flex gap-2 overflow-auto md:w-56 md:flex-col">
            {(screens[0] ? cameras.slice(0, MAX_STRIP) : strip).map((c) => (
              <Tile
                key={`${c.participant.identity}-strip`}
                trackRef={c}
                compact
                pinned={c.participant.identity === pinnedIdentity}
                onTogglePin={onTogglePin}
                className="aspect-video h-24 shrink-0 md:h-auto md:w-full"
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Two people: the other person fills the stage, you float in a corner (Meet-style).
  if (cameras.length === 2) {
    const remote = cameras.find((c) => !c.participant.isLocal) ?? cameras[0]!;
    const self = cameras.find((c) => c !== remote) ?? cameras[1]!;
    return (
      <div className="relative min-h-0 flex-1 p-2">
        <Tile trackRef={remote} onTogglePin={onTogglePin} className="h-full w-full" />
        <div className="absolute bottom-4 end-4 aspect-video w-28 shadow-lg sm:w-44">
          <Tile trackRef={self} compact className="h-full w-full" />
        </div>
      </div>
    );
  }

  const plan = planGrid(cameras.length);
  return (
    <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-2 p-2', plan.className)}>
      {cameras.slice(0, plan.visible).map((c) => (
        <Tile
          key={c.participant.identity}
          trackRef={c}
          onTogglePin={cameras.length > 1 ? onTogglePin : undefined}
        />
      ))}
      {plan.overflow > 0 ? (
        <div className="bg-muted text-muted-foreground flex items-center justify-center rounded-lg text-sm">
          {t('moreParticipants', { count: plan.overflow })}
        </div>
      ) : null}
    </div>
  );
}
