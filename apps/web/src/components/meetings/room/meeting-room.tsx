'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  RoomAudioRenderer,
  useChat,
  useConnectionState,
  useParticipants,
  useRoomContext,
  useTrackToggle,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { Link2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { isTypingTarget } from './meeting-layout';
import { ReactionOverlay, useReactions } from './reactions';
import { useElapsed, useFullscreen, useMeetingDarkTheme, useToggleHand } from './room-hooks';
import { ChatPanel, ParticipantsPanel } from './room-panels';
import { Stage, type StageLayout } from './stage';
import { Toolbar } from './toolbar';

export function MeetingRoom({
  title,
  slug,
  isHost,
  onLeave,
  onEndForAll,
  onRemoveParticipant,
}: {
  title: string;
  /** Public meeting slug, used to copy the (token-free) meeting link. */
  slug: string;
  isHost: boolean;
  onLeave: () => void;
  onEndForAll: () => Promise<void>;
  onRemoveParticipant: (participantId: string) => void;
}) {
  const t = useTranslations('meetings.room');
  const { toast } = useToast();
  useMeetingDarkTheme();

  const room = useRoomContext();
  const state = useConnectionState();
  const participants = useParticipants();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const share = useTrackToggle({ source: Track.Source.ScreenShare });
  const { chatMessages } = useChat();
  const hand = useToggleHand();
  const reactions = useReactions();
  const fullscreen = useFullscreen();
  const elapsed = useElapsed();

  const [panel, setPanel] = useState<'people' | 'chat' | null>(null);
  const [seenChat, setSeenChat] = useState(0);
  const [layout, setLayout] = useState<StageLayout>('grid');
  const [pinned, setPinned] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  useEffect(() => {
    if (panel === 'chat') setSeenChat(chatMessages.length);
  }, [panel, chatMessages.length]);

  const leave = useCallback(() => {
    void room.disconnect();
    onLeave();
  }, [room, onLeave]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${slug}`);
      toast({ title: t('linkCopied') });
    } catch {
      toast({ title: t('linkCopyFailed'), variant: 'destructive' });
    }
  }, [slug, t, toast]);

  // Keyboard: M mic, V camera, H raise hand, C chat, P people (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'm':
          void mic.toggle();
          break;
        case 'v':
          void cam.toggle();
          break;
        case 'h':
          hand.toggle();
          break;
        case 'c':
          setPanel((p) => (p === 'chat' ? null : 'chat'));
          break;
        case 'p':
          setPanel((p) => (p === 'people' ? null : 'people'));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mic, cam, hand]);

  const unread = panel === 'chat' ? 0 : Math.max(0, chatMessages.length - seenChat);
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.Connecting;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-background text-foreground fixed inset-0 z-50 flex flex-col [--ring:214_52%_66%]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
            <span
              className="text-muted-foreground bg-muted rounded-md px-2 py-0.5 text-xs tabular-nums"
              aria-label={t('elapsed')}
            >
              {elapsed}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full max-sm:hidden"
              onClick={copyLink}
            >
              <Link2 aria-hidden="true" />
              {t('copyLink')}
            </Button>
            <span className="text-muted-foreground bg-muted flex items-center gap-1.5 rounded-full px-3 py-1 text-xs">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t('inMeeting', { count: participants.length })}
            </span>
          </div>
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
          <main className="relative flex min-w-0 flex-1 flex-col">
            <Stage
              layout={layout}
              pinnedIdentity={pinned}
              onTogglePin={(id) => setPinned((cur) => (cur === id ? null : id))}
            />
            <ReactionOverlay items={reactions.items} />
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

        <Toolbar
          mic={mic}
          cam={cam}
          share={{ ...share, supported: canShare }}
          hand={hand}
          onReaction={(key) => reactions.sendReaction(key, t('you'))}
          panel={panel}
          onPanel={setPanel}
          unread={unread}
          participantCount={participants.length}
          isHost={isHost}
          onLeave={leave}
          onEndForAll={() => setConfirmEnd(true)}
          layout={layout}
          onLayout={setLayout}
          onCopyLink={copyLink}
          fullscreen={fullscreen}
        />
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
