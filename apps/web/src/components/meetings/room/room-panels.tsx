'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChat, useIsMuted, useParticipants } from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import { Camera, CameraOff, Mic, MicOff, Send, UserMinus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseParticipantMeta } from './meeting-layout';

function ParticipantRow({
  participant,
  canRemove,
  onRemove,
}: {
  participant: Participant;
  canRemove: boolean;
  onRemove: (participantId: string) => void;
}) {
  const t = useTranslations('meetings.room');
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const camMuted = useIsMuted({ participant, source: Track.Source.Camera });
  const meta = parseParticipantMeta(participant.metadata);
  const name = participant.name || participant.identity;

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {name}
          {participant.isLocal ? (
            <span className="text-muted-foreground"> ({t('you')})</span>
          ) : null}
        </p>
        {meta.role === 'guest' ? <Badge size="sm">{t('guest')}</Badge> : null}
      </div>
      <span
        className="text-muted-foreground flex items-center gap-1.5"
        role="img"
        aria-label={`${micMuted ? t('micOff') : t('micOn')}, ${camMuted ? t('cameraOff') : t('cameraOn')}`}
      >
        {micMuted ? (
          <MicOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Mic className="text-foreground h-4 w-4" aria-hidden="true" />
        )}
        {camMuted ? (
          <CameraOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Camera className="text-foreground h-4 w-4" aria-hidden="true" />
        )}
      </span>
      {canRemove && !participant.isLocal && meta.participantId && meta.role !== 'host' ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('removeParticipant', { name })}
          onClick={() => onRemove(meta.participantId!)}
        >
          <UserMinus aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

export function ParticipantsPanel({
  isHost,
  onRemove,
  onClose,
}: {
  isHost: boolean;
  onRemove: (participantId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('meetings.room');
  const participants = useParticipants();
  const hosts = participants.filter((p) => parseParticipantMeta(p.metadata).role === 'host');
  const others = participants.filter((p) => parseParticipantMeta(p.metadata).role !== 'host');

  return (
    <PanelShell title={t('people')} onClose={onClose}>
      {hosts.length > 0 ? (
        <section aria-label={t('host')}>
          <h3 className="kicker px-3 pt-3">{t('host')}</h3>
          <ul>
            {hosts.map((p) => (
              <ParticipantRow
                key={p.identity}
                participant={p}
                canRemove={false}
                onRemove={onRemove}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label={t('participants')}>
        <h3 className="kicker px-3 pt-3">
          {t('participants')} ({others.length})
        </h3>
        <ul>
          {others.map((p) => (
            <ParticipantRow
              key={p.identity}
              participant={p}
              canRemove={isHost}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </section>
    </PanelShell>
  );
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('meetings.room');
  const { chatMessages, send, isSending } = useChat();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chatMessages.length]);

  return (
    <PanelShell title={t('chat')} onClose={onClose}>
      <p className="text-muted-foreground border-border border-b px-3 py-2 text-xs">
        {t('chatNote')}
      </p>
      <ul className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {chatMessages.map((m, i) => (
          <li key={`${m.timestamp}-${i}`}>
            <p className="text-muted-foreground text-xs">
              {m.from?.name || m.from?.identity || '—'}
            </p>
            <p className="break-words text-sm">{m.message}</p>
          </li>
        ))}
        <div ref={endRef} />
      </ul>
      <form
        className="border-border flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          void send(value);
          setText('');
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          aria-label={t('messagePlaceholder')}
          placeholder={t('messagePlaceholder')}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isSending || !text.trim()}
          aria-label={t('send')}
        >
          <Send aria-hidden="true" />
        </Button>
      </form>
    </PanelShell>
  );
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('meetings.room');
  return (
    <aside
      aria-label={title}
      className="bg-card border-border absolute inset-0 z-20 flex flex-col border-s md:static md:inset-auto md:w-80 md:shrink-0"
    >
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label={t('closePanel')}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </aside>
  );
}
