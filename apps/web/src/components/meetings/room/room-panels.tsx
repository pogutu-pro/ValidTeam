'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useChat, useIsMuted, useParticipants } from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import { CameraOff, MicOff, Search, Send, UserMinus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseParticipantMeta } from './meeting-layout';
import { useRaisedHand } from './room-hooks';
import { PersonAvatar } from './stage';

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
      className="bg-card border-border absolute inset-0 z-20 flex flex-col md:static md:inset-auto md:m-2 md:ms-0 md:w-[22rem] md:shrink-0 md:rounded-lg md:border"
    >
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={onClose}
          aria-label={t('closePanel')}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

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
  const hand = useRaisedHand(participant);
  const meta = parseParticipantMeta(participant.metadata);
  const name = participant.name || participant.identity;

  return (
    <li className="hover:bg-muted/60 flex items-center gap-3 px-4 py-2">
      <PersonAvatar name={name} className="h-9 w-9 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {name}
          {participant.isLocal ? (
            <span className="text-muted-foreground font-normal"> ({t('you')})</span>
          ) : null}
        </p>
        <div className="flex gap-1">
          {meta.role === 'host' ? (
            <Badge size="sm" variant="info">
              {t('host')}
            </Badge>
          ) : null}
          {meta.role === 'guest' ? <Badge size="sm">{t('guest')}</Badge> : null}
        </div>
      </div>
      {hand ? (
        <span role="img" aria-label={t('handRaised', { name })} className="text-lg">
          {'✋'}
        </span>
      ) : null}
      <span
        className="text-muted-foreground flex items-center gap-1.5"
        role="img"
        aria-label={`${micMuted ? t('micOff') : t('micOn')}, ${camMuted ? t('cameraOff') : t('cameraOn')}`}
      >
        {micMuted ? <MicOff className="h-4 w-4" aria-hidden="true" /> : null}
        {camMuted ? <CameraOff className="h-4 w-4" aria-hidden="true" /> : null}
      </span>
      {canRemove && !participant.isLocal && meta.participantId && meta.role !== 'host' ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
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
  const [query, setQuery] = useState('');

  const { hosts, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = participants.filter(
      (p) => !q || (p.name || p.identity).toLowerCase().includes(q)
    );
    return {
      hosts: visible.filter((p) => parseParticipantMeta(p.metadata).role === 'host'),
      others: visible.filter((p) => parseParticipantMeta(p.metadata).role !== 'host'),
    };
  }, [participants, query]);

  return (
    <PanelShell title={`${t('people')} (${participants.length})`} onClose={onClose}>
      <div className="px-4 py-3">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPeople')}
            aria-label={t('searchPeople')}
            className="ps-9"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {hosts.length > 0 ? (
          <section aria-label={t('host')}>
            <h3 className="kicker px-4 pb-1 pt-2">{t('host')}</h3>
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
          <h3 className="kicker px-4 pb-1 pt-3">
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
      </div>
    </PanelShell>
  );
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('meetings.room');
  const format = useFormatter();
  const { chatMessages, send, isSending } = useChat();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chatMessages.length]);

  return (
    <PanelShell title={t('chat')} onClose={onClose}>
      <p className="text-muted-foreground bg-muted/50 mx-4 mt-3 rounded-md px-3 py-2 text-xs">
        {t('chatNote')}
      </p>
      <ul
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
        aria-live="polite"
      >
        {chatMessages.map((m, i) => {
          const mine = Boolean(m.from?.isLocal);
          const name = m.from?.name || m.from?.identity || '—';
          return (
            <li
              key={`${m.timestamp}-${i}`}
              className={cn(
                'flex max-w-[85%] flex-col gap-0.5',
                mine ? 'items-end self-end' : 'items-start'
              )}
            >
              <span className="text-muted-foreground text-[11px]">
                {mine ? t('you') : name} ·{' '}
                {format.dateTime(new Date(m.timestamp), { hour: 'numeric', minute: '2-digit' })}
              </span>
              <p
                className={cn(
                  'break-words rounded-lg px-3 py-2 text-sm',
                  mine
                    ? 'bg-accent-blue text-white dark:text-slate-950'
                    : 'bg-secondary text-secondary-foreground'
                )}
              >
                {m.message}
              </p>
            </li>
          );
        })}
        <li ref={endRef} aria-hidden="true" />
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
          className="rounded-full"
          disabled={isSending || !text.trim()}
          aria-label={t('send')}
        >
          <Send aria-hidden="true" />
        </Button>
      </form>
    </PanelShell>
  );
}
