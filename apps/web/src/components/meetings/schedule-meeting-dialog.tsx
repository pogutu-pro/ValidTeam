'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationMembers } from '@/lib/hooks/use-members';
import {
  MeetingApiError,
  useCreateMeeting,
  type CreateMeetingPayload,
} from '@/lib/hooks/use-meetings';
import { CTA_BLUE } from './meeting-format';
import { parseGuestEmails, zonedInputToIso } from './schedule-validation';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const FIELD =
  'border-border bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2';

function defaultStart() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:00`,
  };
}

function timeZones(current: string): string[] {
  try {
    const all =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone'
      ) ?? [];
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
}

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
}) {
  const t = useTranslations('meetings');
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateMeeting();
  const { data: members } = useOrganizationMembers(organizationId);

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zones = useMemo(() => timeZones(browserZone), [browserZone]);
  const initial = useMemo(defaultStart, []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(60);
  const [timezone, setTimezone] = useState(browserZone);
  const [freq, setFreq] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [count, setCount] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [guestsRaw, setGuestsRaw] = useState('');
  const [allowGuests, setAllowGuests] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guests = parseGuestEmails(guestsRaw);
  const candidates = (members?.members ?? []).filter(
    (m) =>
      m.status === 'active' &&
      m.memberStatus === 'active' &&
      !m.isAgent &&
      `${m.name ?? ''} ${m.email ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!organizationId) return;
    if (!title.trim()) return setError(t('errors.titleRequired'));
    const startAt = zonedInputToIso(date, time, timezone);
    if (!startAt) return setError(t('errors.invalidDateTime'));
    if (new Date(startAt).getTime() < Date.now() - 5 * 60_000)
      return setError(t('errors.pastStart'));
    if (guests.invalid.length)
      return setError(t('errors.invalidEmails', { emails: guests.invalid.join(', ') }));
    const n = count ? Number.parseInt(count, 10) : undefined;
    if (count && (!n || n < 1 || n > 366)) return setError(t('errors.invalidCount'));

    const payload: CreateMeetingPayload = {
      organizationId,
      title: title.trim(),
      mode: 'scheduled',
      startAt,
      durationMinutes: duration,
      timezone,
      participantUserIds: [...selected],
      guests: guests.valid.map((email) => ({ email })),
      allowGuests,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(freq !== 'none' ? { recurrence: { freq, interval: 1, ...(n ? { count: n } : {}) } } : {}),
    };
    create.mutate(payload, {
      onSuccess: ({ meeting }) => {
        toast({ title: t('scheduled') });
        onOpenChange(false);
        router.push(`/meetings/${meeting.slug}`);
      },
      onError: (err) => {
        if (err instanceof MeetingApiError && err.code === 'invalid_participants')
          setError(t('errors.invalidParticipants'));
        else if (err instanceof MeetingApiError && err.code === 'guests_not_allowed')
          setError(t('errors.guestsNotAllowed'));
        else setError(t('errors.createFailed'));
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('scheduleDialog.title')}</DialogTitle>
          <DialogDescription>{t('scheduleDialog.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">{t('fields.title')}</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-date">{t('fields.date')}</Label>
              <input
                id="meeting-date"
                type="date"
                className={FIELD}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-time">{t('fields.startTime')}</Label>
              <input
                id="meeting-time"
                type="time"
                className={FIELD}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="meeting-duration">{t('fields.duration')}</Label>
              <select
                id="meeting-duration"
                className={FIELD}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {t('minutes', { count: d })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-tz">{t('fields.timezone')}</Label>
              <select
                id="meeting-tz"
                className={FIELD}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-repeat">{t('fields.repeat')}</Label>
                <select
                  id="meeting-repeat"
                  className={FIELD}
                  value={freq}
                  onChange={(e) => setFreq(e.target.value as typeof freq)}
                >
                  <option value="none">{t('repeat.none')}</option>
                  <option value="daily">{t('repeat.daily')}</option>
                  <option value="weekly">{t('repeat.weekly')}</option>
                  <option value="monthly">{t('repeat.monthly')}</option>
                </select>
              </div>
              {freq !== 'none' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="meeting-count">{t('fields.occurrences')}</Label>
                  <input
                    id="meeting-count"
                    inputMode="numeric"
                    className={FIELD}
                    value={count}
                    placeholder={t('fields.occurrencesPlaceholder')}
                    onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('fields.people')}</legend>
            <Input
              aria-label={t('fields.searchPeople')}
              placeholder={t('fields.searchPeople')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="border-border max-h-40 overflow-y-auto rounded-md border">
              {candidates.length === 0 ? (
                <li className="text-muted-foreground p-3 text-xs">{t('fields.noPeople')}</li>
              ) : (
                candidates.map((m) => (
                  <li key={m.id}>
                    <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="accent-primary h-4 w-4"
                      />
                      <span className="truncate">{m.name ?? m.email}</span>
                      {m.name && m.email ? (
                        <span className="text-muted-foreground truncate text-xs">{m.email}</span>
                      ) : null}
                    </label>
                  </li>
                ))
              )}
            </ul>
            {selected.size > 0 ? (
              <p className="text-muted-foreground text-xs">
                {t('fields.selectedCount', { count: selected.size })}
              </p>
            ) : null}
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="meeting-guests">{t('fields.guests')}</Label>
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                {t('fields.allowGuests')}
                <Switch
                  checked={allowGuests}
                  onCheckedChange={setAllowGuests}
                  aria-label={t('fields.allowGuests')}
                />
              </label>
            </div>
            <Textarea
              id="meeting-guests"
              rows={2}
              value={guestsRaw}
              onChange={(e) => setGuestsRaw(e.target.value)}
              placeholder={t('fields.guestsPlaceholder')}
              disabled={!allowGuests}
            />
            <p className="text-muted-foreground text-xs">{t('fields.guestsHint')}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="meeting-desc">{t('fields.description')}</Label>
            <Textarea
              id="meeting-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              className={CTA_BLUE}
              disabled={create.isPending || !organizationId}
            >
              {t('scheduleDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
