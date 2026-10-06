'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { usePreviewTracks } from '@livekit/components-react';
import { Track, type LocalVideoTrack } from 'livekit-client';
import { Camera, CameraOff, Mic, MicOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { initials } from './meeting-layout';

export interface PrejoinInfo {
  title: string;
  hostName: string | null;
  scheduledStartAt: string;
  status: string;
  isGuest: boolean;
}

export function Prejoin({
  info,
  initialName,
  nameEditable,
  joining,
  error,
  onJoin,
}: {
  info: PrejoinInfo;
  initialName: string;
  nameEditable: boolean;
  joining: boolean;
  error: string | null;
  onJoin: (opts: { name: string; mic: boolean; camera: boolean }) => void;
}) {
  const t = useTranslations('meetings.prejoin');
  const format = useFormatter();
  const [name, setName] = useState(initialName);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [cameraError, setCameraError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const tracks = usePreviewTracks({ audio: false, video: camera }, () => {
    setCameraError(true);
    setCamera(false);
  });
  const videoTrack = tracks?.find((tr) => tr.kind === Track.Kind.Video) as
    | LocalVideoTrack
    | undefined;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  const trimmed = name.trim();
  const start = new Date(info.scheduledStartAt);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center gap-6 p-4 md:flex-row md:items-center md:gap-10">
      <section aria-label={t('preview')} className="w-full md:w-3/5">
        <div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden rounded-lg">
          {camera && videoTrack ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : (
            <span
              className="bg-secondary text-secondary-foreground flex h-20 w-20 items-center justify-center rounded-full text-2xl font-semibold"
              aria-hidden="true"
            >
              {initials(trimmed)}
            </span>
          )}
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            <Button
              type="button"
              size="icon"
              variant={mic ? 'secondary' : 'destructive'}
              aria-pressed={mic}
              aria-label={mic ? t('micOn') : t('micOff')}
              onClick={() => setMic(!mic)}
            >
              {mic ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant={camera ? 'secondary' : 'destructive'}
              aria-pressed={camera}
              aria-label={camera ? t('cameraOn') : t('cameraOff')}
              onClick={() => {
                setCameraError(false);
                setCamera(!camera);
              }}
            >
              {camera ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-center text-xs" aria-live="polite">
          {cameraError
            ? t('cameraBlocked')
            : `${mic ? t('micOn') : t('micOff')} · ${camera ? t('cameraOn') : t('cameraOff')}`}
        </p>
      </section>

      <section className="w-full space-y-4 md:w-2/5">
        <div className="space-y-1">
          <h1 className="text-foreground text-xl font-semibold leading-tight">{info.title}</h1>
          <p className="text-muted-foreground text-sm">
            {info.hostName ? t('organizedBy', { name: info.hostName }) : null}
          </p>
          <p className="text-muted-foreground text-sm">
            {format.dateTime(start, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <div className="flex gap-2 pt-1">
            {info.status === 'live' ? <Badge variant="success">{t('inProgress')}</Badge> : null}
            {info.isGuest ? <Badge>{t('joiningAsGuest')}</Badge> : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="prejoin-name">{t('yourName')}</Label>
          <Input
            id="prejoin-name"
            value={name}
            maxLength={80}
            readOnly={!nameEditable}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <Button
          className="h-11 w-full text-base"
          disabled={joining || !trimmed}
          onClick={() => onJoin({ name: trimmed, mic, camera })}
        >
          {joining ? t('joining') : t('joinMeeting')}
        </Button>
      </section>
    </main>
  );
}
