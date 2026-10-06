'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useChat,
  useConnectionState,
  useIsMuted,
  useIsSpeaking,
  useParticipants,
  useRoomContext,
  useTrackToggle,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import {
  Camera,
  CameraOff,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { initials, parseParticipantMeta, planGrid } from './meeting-layout';
import { ChatPanel, ParticipantsPanel } from './room-panels';

function Tile({
  trackRef,
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  className?: string;
}) {
  const t = useTranslations('meetings.room');
  const { participant } = trackRef;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
  const name = participant.name || participant.identity;
  const meta = parseParticipantMeta(participant.metadata);

  return (
    <div
      className={cn(
        'bg-muted relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg',
        speaking && !isScreen && 'ring-primary ring-2',
        className
      )}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn('h-full w-full', isScreen ? 'object-contain' : 'object-cover')}
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-secondary text-secondary-foreground flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold"
        >
          {initials(name)}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/55 px-2.5 py-1.5 text-xs text-white">
        {!isScreen && micMuted ? (
          <MicOff className="h-3.5 w-3.5 shrink-0" aria-label={t('micOff')} />
        ) : null}
        <span className="truncate">
          {isScreen ? t('presenting', { name }) : name}
          {participant.isLocal && !isScreen ? ` (${t('you')})` : ''}
        </span>
        {meta.role === 'guest' && !isScreen ? (
          <Badge size="sm" variant="muted">
            {t('guest')}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function Stage() {
  const t = useTranslations('meetings.room');
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const screens = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).filter(
    isTrackReference
  );
  const plan = planGrid(cameras.length);

  if (screens.length > 0) {
    // Presenter view: shared screen dominates, participants in a strip.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row">
        <Tile trackRef={screens[0]!} className="min-h-0 flex-1" />
        <div className="flex gap-2 overflow-auto md:w-52 md:flex-col">
          {cameras.slice(0, MAX_STRIP).map((c) => (
            <Tile
              key={`${c.participant.identity}-cam`}
              trackRef={c}
              className="aspect-video h-24 shrink-0 md:h-auto md:w-full"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-2 p-2', plan.className)}>
      {cameras.slice(0, plan.visible).map((c) => (
        <Tile key={c.participant.identity} trackRef={c} />
      ))}
      {plan.overflow > 0 ? (
        <div className="bg-muted text-muted-foreground flex items-center justify-center rounded-lg text-sm">
          {t('moreParticipants', { count: plan.overflow })}
        </div>
      ) : null}
    </div>
  );
}
const MAX_STRIP = 8;

function ControlButton({
  label,
  active = true,
  danger = false,
  onClick,
  disabled,
  children,
  badge,
  pressed,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  badge?: number;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={danger ? 'destructive' : active ? 'secondary' : 'outline'}
          size="icon"
          className="relative h-11 w-11 sm:h-10 sm:w-10"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
          {badge ? (
            <span className="bg-primary text-primary-foreground absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MeetingRoom({
  title,
  isHost,
  onLeave,
  onEndForAll,
  onRemoveParticipant,
}: {
  title: string;
  isHost: boolean;
  onLeave: () => void;
  onEndForAll: () => Promise<void>;
  onRemoveParticipant: (participantId: string) => void;
}) {
  const t = useTranslations('meetings.room');
  const room = useRoomContext();
  const state = useConnectionState();
  const participants = useParticipants();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const share = useTrackToggle({ source: Track.Source.ScreenShare });
  const { chatMessages } = useChat();
  const [panel, setPanel] = useState<'people' | 'chat' | null>(null);
  const [seenChat, setSeenChat] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  useEffect(() => {
    if (panel === 'chat') setSeenChat(chatMessages.length);
  }, [panel, chatMessages.length]);

  // Keyboard shortcuts: M mic, V camera (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'm') void mic.toggle();
      if (e.key === 'v') void cam.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mic, cam]);

  const leave = useCallback(() => {
    void room.disconnect();
    onLeave();
  }, [room, onLeave]);

  const unread = panel === 'chat' ? 0 : Math.max(0, chatMessages.length - seenChat);
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.Connecting;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background fixed inset-0 z-50 flex flex-col">
        <header className="border-border flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {t('inMeeting', { count: participants.length })}
          </span>
        </header>
        {reconnecting ? (
          <div
            role="status"
            className="bg-accent-amber/15 text-accent-amber px-3 py-1.5 text-center text-xs"
          >
            {t('reconnecting')}
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <Stage />
          </main>
          {panel === 'people' ? (
            <ParticipantsPanel
              isHost={isHost}
              onRemove={onRemoveParticipant}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel === 'chat' ? <ChatPanel onClose={() => setPanel(null)} /> : null}
        </div>

        <nav
          aria-label={t('controls')}
          className="border-border bg-card flex shrink-0 items-center justify-center gap-2 border-t px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        >
          <ControlButton
            label={mic.enabled ? t('muteMic') : t('unmuteMic')}
            active={mic.enabled}
            pressed={mic.enabled}
            onClick={() => void mic.toggle()}
            disabled={mic.pending}
          >
            {mic.enabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
          </ControlButton>
          <ControlButton
            label={cam.enabled ? t('stopCamera') : t('startCamera')}
            active={cam.enabled}
            pressed={cam.enabled}
            onClick={() => void cam.toggle()}
            disabled={cam.pending}
          >
            {cam.enabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
          </ControlButton>
          {canShare ? (
            <ControlButton
              label={share.enabled ? t('stopShare') : t('shareScreen')}
              active={!share.enabled}
              pressed={share.enabled}
              onClick={() => void share.toggle()}
              disabled={share.pending}
            >
              <MonitorUp aria-hidden="true" />
            </ControlButton>
          ) : null}
          <ControlButton
            label={t('people')}
            pressed={panel === 'people'}
            active={panel !== 'people'}
            onClick={() => setPanel(panel === 'people' ? null : 'people')}
          >
            <Users aria-hidden="true" />
          </ControlButton>
          <ControlButton
            label={t('chat')}
            pressed={panel === 'chat'}
            active={panel !== 'chat'}
            badge={unread}
            onClick={() => setPanel(panel === 'chat' ? null : 'chat')}
          >
            <MessageSquare aria-hidden="true" />
          </ControlButton>
          {isHost ? (
            <ControlButton
              label={t('endForAll')}
              onClick={() => setConfirmEnd(true)}
              active={false}
            >
              <PhoneOff aria-hidden="true" />
            </ControlButton>
          ) : null}
          <Button variant="destructive" className="ms-2 h-11 gap-2 px-4 sm:h-10" onClick={leave}>
            <LogOut aria-hidden="true" />
            {t('leave')}
          </Button>
        </nav>
      </div>

      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('endConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('endConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={ending}
              onClick={async () => {
                setEnding(true);
                await onEndForAll().catch(() => undefined);
                setEnding(false);
                setConfirmEnd(false);
                leave();
              }}
            >
              {t('endForAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RoomAudioRenderer />
    </TooltipProvider>
  );
}
