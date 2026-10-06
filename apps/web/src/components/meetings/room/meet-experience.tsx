'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LiveKitRoom } from '@livekit/components-react';
import { DisconnectReason } from 'livekit-client';
import { Button } from '@/components/ui/button';
import { useUser } from '@/lib/hooks/use-user';
import { MeetingApiError, meetingFetch, type MeetingDetail } from '@/lib/hooks/use-meetings';
import { MeetingRoom } from './meeting-room';
import { Prejoin, type PrejoinInfo } from './prejoin';

interface JoinResponse {
  url: string;
  token: string;
  role: 'host' | 'participant' | 'guest';
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'denied'; reason: 'signin' | 'notFound' | 'closed' | 'invalidGuestLink' | 'error' }
  | { kind: 'prejoin'; info: PrejoinInfo; name: string; guest: boolean }
  | {
      kind: 'room';
      join: JoinResponse;
      info: PrejoinInfo;
      initial: { mic: boolean; camera: boolean };
    }
  | { kind: 'left'; reason: 'left' | 'removed' | 'ended' };

const PULSE_MS = 30_000;

export function MeetExperience({ slug }: { slug: string }) {
  const t = useTranslations('meetings');
  const { user, isLoading: userLoading } = useUser();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestToken = useRef<string | null>(null);
  const clientSessionId = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replaceAll('-', '')
      : String(Date.now())
  );

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (userLoading) return;
    let cancelled = false;
    // Capture the guest token once, then remove it from the address bar so it
    // does not leak through history, screenshots or the Referer header.
    if (!guestToken.current) {
      const g = new URLSearchParams(window.location.search).get('g');
      if (g) {
        guestToken.current = g;
        const url = new URL(window.location.href);
        url.searchParams.delete('g');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    }
    const token = guestToken.current;
    (async () => {
      try {
        if (token) {
          const r = await meetingFetch<{
            meeting: {
              title: string;
              status: string;
              scheduledStartAt: string;
              host: { name: string | null };
            };
            guest: { name: string | null };
          }>(`/api/meetings/${encodeURIComponent(slug)}/guest-preview`, {
            method: 'POST',
            body: JSON.stringify({ token }),
          });
          if (cancelled) return;
          setPhase({
            kind: 'prejoin',
            guest: true,
            name: r.guest.name ?? '',
            info: {
              title: r.meeting.title,
              hostName: r.meeting.host.name,
              scheduledStartAt: r.meeting.scheduledStartAt,
              status: r.meeting.status,
              isGuest: true,
            },
          });
          return;
        }
        const d = await meetingFetch<MeetingDetail>(`/api/meetings/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        const m = d.meeting;
        if (m.status === 'ended' || m.status === 'cancelled')
          return setPhase({ kind: 'denied', reason: 'closed' });
        setPhase({
          kind: 'prejoin',
          guest: false,
          name: user?.name ?? user?.email ?? '',
          info: {
            title: m.title,
            hostName: m.host.name,
            scheduledStartAt: m.scheduledStartAt,
            status: m.status,
            isGuest: false,
          },
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof MeetingApiError) {
          if (token)
            return setPhase({
              kind: 'denied',
              reason: e.code === 'invalid_guest_link' ? 'invalidGuestLink' : 'error',
            });
          if (e.status === 401) return setPhase({ kind: 'denied', reason: 'signin' });
          if (e.status === 404) return setPhase({ kind: 'denied', reason: 'notFound' });
        }
        setPhase({ kind: 'denied', reason: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `user` identity is stable once loaded; reloadKey re-runs the lookup on rejoin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, userLoading, reloadKey]);

  const join = useCallback(
    async (opts: { name: string; mic: boolean; camera: boolean }) => {
      if (phase.kind !== 'prejoin') return;
      setJoining(true);
      setError(null);
      try {
        const base = `/api/meetings/${encodeURIComponent(slug)}`;
        const res = phase.guest
          ? await meetingFetch<JoinResponse>(`${base}/guest-join`, {
              method: 'POST',
              body: JSON.stringify({
                token: guestToken.current,
                name: opts.name,
                clientSessionId: clientSessionId.current,
              }),
            })
          : await meetingFetch<JoinResponse>(`${base}/join`, {
              method: 'POST',
              body: JSON.stringify({ clientSessionId: clientSessionId.current }),
            });
        setPhase({
          kind: 'room',
          join: res,
          info: phase.info,
          initial: { mic: opts.mic, camera: opts.camera },
        });
      } catch (e) {
        const code = e instanceof MeetingApiError ? e.code : 'error';
        const key =
          (
            {
              too_early: 'tooEarly',
              meeting_ended: 'ended',
              meeting_cancelled: 'ended',
              meeting_expired: 'ended',
              livekit_unavailable: 'unavailable',
              rate_limited: 'rateLimited',
              invalid_guest_link: 'invalidGuestLink',
              forbidden: 'forbidden',
            } as Record<string, string>
          )[code] ?? 'generic';
        setError(t(`prejoin.errors.${key}`));
      } finally {
        setJoining(false);
      }
    },
    [phase, slug, t]
  );

  // Browser keep-alive: only a fallback for the server-side LiveKit reconciliation.
  useEffect(() => {
    if (phase.kind !== 'room') return;
    const send = () => {
      void fetch(`/api/meetings/${encodeURIComponent(slug)}/pulse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guestToken.current ? { guestToken: guestToken.current } : {}),
        keepalive: true,
      }).catch(() => undefined);
    };
    const id = window.setInterval(send, PULSE_MS);
    return () => window.clearInterval(id);
  }, [phase.kind, slug]);

  const base = `/api/meetings/${encodeURIComponent(slug)}`;

  if (phase.kind === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </main>
    );
  }

  if (phase.kind === 'denied') {
    return (
      <Notice title={t(`denied.${phase.reason}.title`)} body={t(`denied.${phase.reason}.body`)}>
        {phase.reason === 'signin' ? (
          <Button asChild>
            <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(`/meet/${slug}`)}`}>
              {t('denied.signin.action')}
            </Link>
          </Button>
        ) : null}
      </Notice>
    );
  }

  if (phase.kind === 'left') {
    return (
      <Notice title={t(`left.${phase.reason}.title`)} body={t(`left.${phase.reason}.body`)}>
        {phase.reason === 'left' ? (
          <Button
            onClick={() => {
              setPhase({ kind: 'loading' });
              setReloadKey((k) => k + 1);
            }}
          >
            {t('left.rejoin')}
          </Button>
        ) : null}
        {!guestToken.current ? (
          <Button asChild variant="outline">
            <Link href={`/meetings/${slug}`}>{t('left.viewMeeting')}</Link>
          </Button>
        ) : null}
      </Notice>
    );
  }

  if (phase.kind === 'prejoin') {
    return (
      <Prejoin
        info={phase.info}
        initialName={phase.name}
        nameEditable={phase.guest}
        joining={joining}
        error={error}
        onJoin={join}
      />
    );
  }

  return (
    <LiveKitRoom
      serverUrl={phase.join.url}
      token={phase.join.token}
      connect
      audio={phase.initial.mic}
      video={phase.initial.camera}
      onDisconnected={(reason) => {
        if (reason === DisconnectReason.PARTICIPANT_REMOVED)
          setPhase({ kind: 'left', reason: 'removed' });
        else if (reason === DisconnectReason.ROOM_DELETED)
          setPhase({ kind: 'left', reason: 'ended' });
      }}
      onError={() => undefined}
      data-lk-theme="default"
    >
      <MeetingRoom
        title={phase.info.title}
        isHost={phase.join.role === 'host'}
        onLeave={() => setPhase((p) => (p.kind === 'room' ? { kind: 'left', reason: 'left' } : p))}
        onEndForAll={async () => {
          await meetingFetch(`${base}/end`, { method: 'POST' });
        }}
        onRemoveParticipant={(participantId) => {
          void meetingFetch(
            `${base}/participants?participantId=${encodeURIComponent(participantId)}`,
            { method: 'DELETE' }
          ).catch(() => undefined);
        }}
      />
    </LiveKitRoom>
  );
}

function Notice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
      <div className="flex gap-2 pt-2">{children}</div>
    </main>
  );
}
