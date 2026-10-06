'use client';

/** TanStack Query hooks for the Meetings API (/api/meetings/*). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type MeetingScope = 'upcoming' | 'live' | 'past';

export interface MeetingListItem {
  slug: string;
  title: string;
  status: MeetingStatus;
  isInstant: boolean;
  isRecurring: boolean;
  scheduledStartAt: string;
  scheduledEndAt: string;
  timezone: string;
  joinPath: string;
  host: { id: string; name: string | null; email: string | null };
  participantCount: number;
  isHost: boolean;
}

export interface MeetingDetail {
  meeting: Omit<MeetingListItem, 'host' | 'participantCount' | 'isHost'> & {
    description: string | null;
    access: 'invited' | 'organization';
    allowGuests: boolean;
    actualStartedAt: string | null;
    endedAt: string | null;
    recordingStatus: string;
    transcriptionStatus: string;
    captionStatus: string;
    host: { name: string | null };
  };
  you: { isHost: boolean; canManage: boolean; canJoin: boolean };
  participants: Array<{
    participantId: string;
    role: 'host' | 'participant';
    kind: 'member' | 'guest';
    name: string | null;
    email: string | null;
    attendance?: {
      firstJoinedAt: string | null;
      lastLeftAt: string | null;
      attendedSeconds: number | null;
      attendancePct: number | null;
      joinCount: number | null;
      lateArrival: boolean | null;
      earlyDeparture: boolean | null;
      noShow: boolean | null;
    } | null;
  }>;
}

export interface CreateMeetingPayload {
  organizationId: string;
  title: string;
  description?: string;
  mode: 'instant' | 'scheduled';
  startAt?: string;
  durationMinutes: number;
  timezone: string;
  participantUserIds: string[];
  guests: Array<{ email: string }>;
  recurrence?: { freq: 'daily' | 'weekly' | 'monthly'; interval?: number; count?: number };
  access?: 'invited' | 'organization';
  allowGuests?: boolean;
}

export class MeetingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export async function meetingFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new MeetingApiError(
      e.code ?? 'error',
      res.status,
      e.message ?? 'Request failed',
      e.details
    );
  }
  return body as T;
}

export function useMeetings(organizationId: string | null, scope: MeetingScope) {
  return useQuery({
    queryKey: ['meetings', organizationId, scope],
    enabled: Boolean(organizationId),
    // Live and upcoming lists change on their own; keep them reasonably fresh.
    refetchInterval: scope === 'past' ? false : 30_000,
    queryFn: () =>
      meetingFetch<{ meetings: MeetingListItem[]; nextOffset: number | null }>(
        `/api/meetings?organizationId=${encodeURIComponent(organizationId!)}&scope=${scope}&limit=50`
      ),
  });
}

export function useMeeting(slug: string) {
  return useQuery({
    queryKey: ['meeting', slug],
    queryFn: () => meetingFetch<MeetingDetail>(`/api/meetings/${encodeURIComponent(slug)}`),
    retry: false,
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMeetingPayload) =>
      meetingFetch<{ meeting: MeetingListItem; occurrencesCreated: number }>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  });
}

export function useMeetingAction(slug: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['meeting', slug] });
    void qc.invalidateQueries({ queryKey: ['meetings'] });
  };
  const base = `/api/meetings/${encodeURIComponent(slug)}`;
  return {
    cancel: useMutation({
      mutationFn: (scope: 'occurrence' | 'series') =>
        meetingFetch(base, { method: 'PATCH', body: JSON.stringify({ cancel: true, scope }) }),
      onSuccess: invalidate,
    }),
    end: useMutation({
      mutationFn: () => meetingFetch(`${base}/end`, { method: 'POST' }),
      onSuccess: invalidate,
    }),
    invite: useMutation({
      mutationFn: (p: { participantUserIds: string[]; guests: Array<{ email: string }> }) =>
        meetingFetch(`${base}/participants`, { method: 'POST', body: JSON.stringify(p) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (participantId: string) =>
        meetingFetch(`${base}/participants?participantId=${encodeURIComponent(participantId)}`, {
          method: 'DELETE',
        }),
      onSuccess: invalidate,
    }),
  };
}

export interface MeetingStatsResponse {
  available: boolean;
  summary?: {
    durationSeconds: number | null;
    invitedCount: number;
    attendedCount: number;
    noShowCount: number;
    peakConcurrent: number;
    totalParticipantSeconds: number;
    avgAttendanceSeconds: number | null;
    avgAttendancePct: number | null;
    lateArrivals: number;
    earlyDepartures: number;
    totalJoins: number;
    totalLeaves: number;
  };
  participants?: Array<{
    participantId: string;
    name: string | null;
    kind: 'member' | 'guest';
    attendedSeconds: number | null;
    attendancePct: number | null;
    noShow: boolean | null;
    lateArrival: boolean | null;
    earlyDeparture: boolean | null;
  }>;
}

export function useMeetingStats(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['meeting-stats', slug],
    enabled,
    queryFn: () =>
      meetingFetch<MeetingStatsResponse>(`/api/meetings/${encodeURIComponent(slug)}/analytics`),
  });
}

export interface OrgMeetingAnalytics {
  volume: { total: number; scheduled: number; completed: number; cancelled: number; live: number };
  attendance: {
    invited: number;
    attended: number;
    noShows: number;
    attendanceRate: number | null;
    noShowRate: number | null;
    lateArrivalRate: number | null;
    earlyDepartureRate: number | null;
  };
  time: {
    totalMeetingHours: number;
    avgMeetingDurationSeconds: number | null;
    avgAttendanceDurationSeconds: number | null;
  };
  health: { avgPeakParticipants: number | null; avgInvitedPerMeeting: number | null };
  participation: {
    topHosts: Array<{ userId: string; name: string | null; email: string | null; hosted: number }>;
    people: Array<{
      userId: string;
      name: string | null;
      email: string | null;
      invited: number;
      attended: number;
      noShows: number;
      attendedSeconds: number;
      avgAttendancePct: number | null;
    }>;
  };
  trends: Array<{
    bucket: string;
    meetings: number;
    completed: number;
    cancelled: number;
    meetingHours: number;
    attendanceRate: number | null;
    noShowRate: number | null;
  }>;
}

export interface PersonalMeetingAnalytics {
  summary: {
    invited: number;
    attended: number;
    missed: number;
    hosted: number;
    totalMeetingHours: number;
    avgAttendanceSeconds: number | null;
    avgAttendancePct: number | null;
    lateArrivals: number;
    earlyDepartures: number;
    totalJoins: number;
  };
  trend: Array<{
    bucket: string;
    attended: number;
    missed: number;
    hours: number;
    avgAttendancePct: number | null;
  }>;
  history: Array<{
    slug: string;
    title: string;
    scheduledStartAt: string;
    attendedSeconds: number | null;
    attendancePct: number | null;
    noShow: boolean | null;
  }>;
}

export function useMeetingAnalytics<T extends 'organization' | 'me'>(params: {
  organizationId: string | null;
  scope: T;
  from: string;
  to: string;
  bucket: 'day' | 'week' | 'month';
  timezone: string;
  recurring?: boolean | undefined;
  external?: boolean | undefined;
  enabled?: boolean;
}) {
  const {
    organizationId,
    scope,
    from,
    to,
    bucket,
    timezone,
    recurring,
    external,
    enabled = true,
  } = params;
  return useQuery({
    queryKey: [
      'meeting-analytics',
      organizationId,
      scope,
      from,
      to,
      bucket,
      timezone,
      recurring,
      external,
    ],
    enabled: Boolean(organizationId) && enabled,
    retry: false,
    queryFn: () => {
      const q = new URLSearchParams({
        organizationId: organizationId!,
        scope,
        from,
        to,
        bucket,
        timezone,
      });
      if (recurring !== undefined) q.set('recurring', String(recurring));
      if (external !== undefined) q.set('external', String(external));
      return meetingFetch<
        T extends 'organization' ? OrgMeetingAnalytics : PersonalMeetingAnalytics
      >(`/api/meetings/analytics?${q.toString()}`);
    },
  });
}
