'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { usePreviewTracks, useTrackVolume } from '@livekit/components-react';
import { Track, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { Camera, CameraOff, Mic, MicOff, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CTA_BLUE } from '../meeting-format';
import { PersonAvatar } from './stage';

export interface PrejoinInfo {
  title: string;
  hostName: string | null;
  scheduledStartAt: string;
  status: string;
  isGuest: boolean;
}

export interface JoinChoices {
  name: string;
  mic: boolean;
  camera: boolean;
  micDeviceId?: string | undefined;
  cameraDeviceId?: string | undefined;
}

function LevelMeter({ track, active }: { track: LocalAudioTrack | undefined; active: boolean }) {
  const level = useTrackVolume(track);
  const lit = active ? Math.min(5, Math.round(level * 12)) : 0;
  return (
    <span className="flex h-5 items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn('w-1 rounded-sm', i < lit ? 'bg-accent-emerald' : 'bg-white/30')}
          style={{ height: `${6 + i * 3}px` }}
        />
      ))}
    </span>
  );
}

function DeviceSelect({
  icon,
  label,
  value,
  devices,
  onChange,
  defaultLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  devices: MediaDeviceInfo[];
  onChange: (id: string) => void;
  defaultLabel: string;
}) {
  return (
    <label className="border-border bg-card focus-within:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 focus-within:ring-2">
      <span className="text-muted-foreground shrink-0" aria-hidden="true">
        {icon}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-0 flex-1 truncate bg-transparent text-sm focus:outline-none"
      >
        <option value="">{defaultLabel}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
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
  onJoin: (choices: JoinChoices) => void;
}) {
  const t = useTranslations('meetings.prejoin');
  const format = useFormatter();
  const [name, setName] = useState(initialName);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }>({
    mics: [],
    cams: [],
  });
  const videoRef = useRef<HTMLVideoElement>(null);

  const tracks = usePreviewTracks(
    {
      audio: mic ? (micId ? { deviceId: micId } : true) : false,
      video: camera ? (camId ? { deviceId: camId } : true) : false,
    },
    () => {
      setCameraError(true);
      setCamera(false);
    }
  );
  const videoTrack = tracks?.find((tr) => tr.kind === Track.Kind.Video) as
    | LocalVideoTrack
    | undefined;
  const audioTrack = tracks?.find((tr) => tr.kind === Track.Kind.Audio) as
    | LocalAudioTrack
    | undefined;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  // Device labels only appear once permission is granted, so refresh after tracks open.
  useEffect(() => {
    const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let cancelled = false;
    const load = () =>
      md
        .enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          setDevices({
            mics: all.filter((d) => d.kind === 'audioinput'),
            cams: all.filter((d) => d.kind === 'videoinput'),
          });
        })
        .catch(() => undefined);
    void load();
    md.addEventListener?.('devicechange', load);
    return () => {
      cancelled = true;
      md.removeEventListener?.('devicechange', load);
    };
  }, [videoTrack, audioTrack]);

  const trimmed = name.trim();
  const start = new Date(info.scheduledStartAt);

  return (
    <main className="bg-background mx-auto grid min-h-dvh w-full max-w-6xl content-center items-start gap-6 p-4 [--ring:214_58%_40%] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:p-8 dark:[--ring:214_52%_66%]">
      <section aria-label={t('preview')} className="w-full space-y-3">
        <div className="bg-muted ring-border relative flex aspect-video items-center justify-center overflow-hidden rounded-lg ring-1">
          {camera && videoTrack ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <PersonAvatar name={trimmed || info.title} className="h-24 w-24 text-3xl" />
              <p className="text-muted-foreground text-sm">
                {cameraError ? t('cameraBlocked') : t('cameraOffNotice')}
              </p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
            <Button
              type="button"
              size="icon"
              variant={mic ? 'secondary' : 'destructive'}
              className="h-14 w-14 rounded-full shadow-md"
              aria-pressed={mic}
              aria-label={mic ? t('micOn') : t('micOff')}
              onClick={() => setMic(!mic)}
            >
              {mic ? (
                <Mic className="!h-6 !w-6" aria-hidden="true" />
              ) : (
                <MicOff className="!h-6 !w-6" aria-hidden="true" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant={camera ? 'secondary' : 'destructive'}
              className="h-14 w-14 rounded-full shadow-md"
              aria-pressed={camera}
              aria-label={camera ? t('cameraOn') : t('cameraOff')}
              onClick={() => {
                setCameraError(false);
                setCamera(!camera);
              }}
            >
              {camera ? (
                <Camera className="!h-6 !w-6" aria-hidden="true" />
              ) : (
                <CameraOff className="!h-6 !w-6" aria-hidden="true" />
              )}
            </Button>
          </div>
          <div className="absolute start-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
            <LevelMeter track={audioTrack} active={mic} />
            <span>{mic ? t('micOn') : t('micOff')}</span>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {`${mic ? t('micOn') : t('micOff')} · ${camera ? t('cameraOn') : t('cameraOff')}`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <DeviceSelect
            icon={<Mic className="h-4 w-4" />}
            label={t('microphone')}
            value={micId}
            devices={devices.mics}
            onChange={setMicId}
            defaultLabel={t('defaultDevice')}
          />
          <DeviceSelect
            icon={<Video className="h-4 w-4" />}
            label={t('camera')}
            value={camId}
            devices={devices.cams}
            onChange={setCamId}
            defaultLabel={t('defaultDevice')}
          />
        </div>
      </section>

      <section className="w-full space-y-5">
        <div className="space-y-2">
          <p className="kicker">{t('readyToJoin')}</p>
          <h1 className="text-foreground text-balance text-3xl font-semibold leading-tight tracking-tight">
            {info.title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {info.hostName ? t('organizedBy', { name: info.hostName }) : null}
            {info.hostName ? ' · ' : ''}
            {format.dateTime(start, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <div className="flex flex-wrap gap-2">
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
            className="h-11"
          />
          {nameEditable ? <p className="text-muted-foreground text-xs">{t('nameHint')}</p> : null}
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <Button
          className={cn(CTA_BLUE, 'h-12 w-full text-base font-semibold')}
          disabled={joining || !trimmed}
          onClick={() =>
            onJoin({
              name: trimmed,
              mic,
              camera,
              micDeviceId: micId || undefined,
              cameraDeviceId: camId || undefined,
            })
          }
        >
          {joining ? t('joining') : t('joinMeeting')}
        </Button>
      </section>
    </main>
  );
}
