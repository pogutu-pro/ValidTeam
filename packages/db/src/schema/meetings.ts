import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  varchar,
  integer,
  boolean,
  jsonb,
  real,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Meetings (0069). A first-class product area, independent of projects and of
 * the chat-call tables in ./chat. A meeting belongs to exactly one
 * organization; every query MUST filter on organization_id (no RLS).
 *
 * All instants are timestamptz (UTC); the IANA zone a meeting/series was
 * authored in is stored separately so recurrence keeps wall-clock time across
 * DST changes.
 */

export const meetingStatusEnum = pgEnum('meeting_status', [
  'scheduled',
  'live',
  'ended',
  'cancelled',
]);

export const meetingParticipantRoleEnum = pgEnum('meeting_participant_role', [
  'host',
  'participant',
]);

export const meetingAccessEnum = pgEnum('meeting_access', ['invited', 'organization']);

/**
 * Reserved for future recording / transcription / captions. Everything defaults
 * to 'none' and NOTHING in Phase 1 transitions these columns: no egress, no
 * transcription and no caption workers exist.
 */
export const meetingMediaFeatureStatusEnum = pgEnum('meeting_media_feature_status', [
  'none',
  'processing',
  'ready',
  'failed',
]);

export const meetingNotificationKindEnum = pgEnum('meeting_notification_kind', [
  'invitation',
  'reminder_30m',
  'no_show_30m',
  'summary',
]);

export const meetingNotificationStatusEnum = pgEnum('meeting_notification_status', [
  'claimed',
  'sent',
  'failed',
  'skipped',
]);

export const meetingSeries = pgTable(
  'meeting_series',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hostId: text('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    /** First occurrence (UTC instant); wall-clock time is re-derived in `timezone`. */
    anchorStartAt: timestamp('anchor_start_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    /** { freq, interval, byWeekday?, count?, until? } — validated in lib/meetings/recurrence. */
    rule: jsonb('rule').notNull(),
    /** Invitee template copied onto every materialised occurrence. */
    participantTemplate: jsonb('participant_template').notNull().default('{}'),
    access: meetingAccessEnum('access').notNull().default('invited'),
    allowGuests: boolean('allow_guests').notNull().default(true),
    /** Occurrences up to this instant have been materialised. */
    generatedThrough: timestamp('generated_through', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index('meeting_series_org_idx').on(table.organizationId),
    activeIdx: index('meeting_series_active_idx').on(table.cancelledAt, table.generatedThrough),
  })
);

export const meetings = pgTable(
  'meetings',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    /** Unguessable public identifier used in /meet/<slug> and the API. */
    slug: varchar('slug', { length: 40 }).notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    seriesId: text('series_id').references(() => meetingSeries.id, { onDelete: 'cascade' }),
    /** Original local date (YYYY-MM-DD in the series zone) — idempotency key for occurrences. */
    occurrenceKey: varchar('occurrence_key', { length: 10 }),
    hostId: text('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    status: meetingStatusEnum('status').notNull().default('scheduled'),
    isInstant: boolean('is_instant').notNull().default(false),
    access: meetingAccessEnum('access').notNull().default('invited'),
    allowGuests: boolean('allow_guests').notNull().default(true),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }).notNull(),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }).notNull(),
    /** Bumped on reschedule so reminder/no-show notifications can fire again. */
    scheduleVersion: integer('schedule_version').notNull().default(1),
    /** Moment the room went live (first token issued / first join). */
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by').references(() => users.id, { onDelete: 'set null' }),
    endReason: varchar('end_reason', { length: 40 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    livekitRoomName: varchar('livekit_room_name', { length: 255 }),
    recordingStatus: meetingMediaFeatureStatusEnum('recording_status').notNull().default('none'),
    transcriptionStatus: meetingMediaFeatureStatusEnum('transcription_status')
      .notNull()
      .default('none'),
    captionStatus: meetingMediaFeatureStatusEnum('caption_status').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('meeting_slug_idx').on(table.slug),
    livekitRoomIdx: uniqueIndex('meeting_livekit_room_idx').on(table.livekitRoomName),
    occurrenceIdx: uniqueIndex('meeting_series_occurrence_idx').on(
      table.seriesId,
      table.occurrenceKey
    ),
    orgScheduledIdx: index('meeting_org_scheduled_idx').on(
      table.organizationId,
      table.scheduledStartAt
    ),
    orgStatusScheduledIdx: index('meeting_org_status_scheduled_idx').on(
      table.organizationId,
      table.status,
      table.scheduledStartAt
    ),
    hostIdx: index('meeting_host_idx').on(table.hostId, table.scheduledStartAt),
    // Cron scans: "open" meetings by time, across organizations.
    statusScheduledIdx: index('meeting_status_scheduled_idx').on(
      table.status,
      table.scheduledStartAt
    ),
    orgEndedIdx: index('meeting_org_ended_idx').on(table.organizationId, table.endedAt),
    endsAfterStart: check(
      'meeting_ends_after_start',
      sql`${table.scheduledEndAt} > ${table.scheduledStartAt}`
    ),
  })
);

/**
 * Invitees: exactly one of `user_id` (internal) or `guest_email` (external).
 * Per-person attendance rollups are written here when the meeting ends so
 * organisation analytics never rescan raw sessions.
 */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestEmail: varchar('guest_email', { length: 320 }),
    guestName: varchar('guest_name', { length: 200 }),
    role: meetingParticipantRoleEnum('role').notNull().default('participant'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by').references(() => users.id, { onDelete: 'set null' }),
    // Attendance rollup (NULL until the meeting ends / stats are computed).
    statsComputedAt: timestamp('stats_computed_at', { withTimezone: true }),
    firstJoinedAt: timestamp('first_joined_at', { withTimezone: true }),
    lastLeftAt: timestamp('last_left_at', { withTimezone: true }),
    attendedSeconds: integer('attended_seconds'),
    attendancePct: real('attendance_pct'),
    joinCount: integer('join_count'),
    leaveCount: integer('leave_count'),
    lateArrival: boolean('late_arrival'),
    earlyDeparture: boolean('early_departure'),
    noShow: boolean('no_show'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingUserIdx: uniqueIndex('meeting_participant_meeting_user_idx').on(
      table.meetingId,
      table.userId
    ),
    meetingGuestIdx: uniqueIndex('meeting_participant_meeting_guest_idx').on(
      table.meetingId,
      table.guestEmail
    ),
    userIdx: index('meeting_participant_user_idx').on(table.organizationId, table.userId),
    meetingIdx: index('meeting_participant_meeting_idx').on(table.meetingId),
    exactlyOneIdentity: check(
      'meeting_participant_one_identity',
      sql`(${table.userId} IS NOT NULL) <> (${table.guestEmail} IS NOT NULL)`
    ),
  })
);

/**
 * Guest credentials. Only a SHA-256 hash is stored; the raw token exists only
 * inside the invitation link. Several tokens may be live for one guest
 * (invitation, reminder, ...) and all die together on removal / expiry.
 */
export const meetingGuestTokens = pgTable(
  'meeting_guest_tokens',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => meetingParticipants.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    hashIdx: uniqueIndex('meeting_guest_token_hash_idx').on(table.tokenHash),
    participantIdx: index('meeting_guest_token_participant_idx').on(table.participantId),
  })
);

/**
 * One row per continuous connection of a participant. Rejoins create new rows;
 * attendance is the UNION of these intervals, never last_leave - first_join.
 * `identity` is the LiveKit participant identity (one per browser tab).
 */
export const meetingAttendanceSessions = pgTable(
  'meeting_attendance_sessions',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => meetingParticipants.id, { onDelete: 'cascade' }),
    identity: varchar('identity', { length: 255 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** left | disconnected | removed | meeting_ended | reconciled */
    leaveReason: varchar('leave_reason', { length: 40 }),
    /** webhook | reconcile — how the session was first observed. */
    source: varchar('source', { length: 20 }).notNull().default('webhook'),
    /** Browser pulse fallback; only consulted when LiveKit cannot be queried. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingParticipantIdx: index('meeting_attendance_meeting_participant_idx').on(
      table.meetingId,
      table.participantId
    ),
    // One open session per identity => duplicate join webhooks are no-ops.
    openIdentityIdx: uniqueIndex('meeting_attendance_open_identity_idx')
      .on(table.meetingId, table.identity)
      .where(sql`${table.leftAt} IS NULL`),
    openIdx: index('meeting_attendance_open_idx')
      .on(table.meetingId)
      .where(sql`${table.leftAt} IS NULL`),
    orgJoinedIdx: index('meeting_attendance_org_joined_idx').on(
      table.organizationId,
      table.joinedAt
    ),
    endsAfterJoin: check(
      'meeting_attendance_left_after_join',
      sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.joinedAt}`
    ),
  })
);

/** Low-frequency lifecycle events only (no per-track or per-heartbeat noise). */
export const meetingEvents = pgTable(
  'meeting_events',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => meetingParticipants.id, {
      onDelete: 'set null',
    }),
    type: varchar('type', { length: 50 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    data: jsonb('data').notNull().default('{}'),
  },
  (table) => ({
    meetingIdx: index('meeting_event_meeting_idx').on(table.meetingId, table.occurredAt),
    orgTypeIdx: index('meeting_event_org_type_idx').on(
      table.organizationId,
      table.type,
      table.occurredAt
    ),
  })
);

/**
 * Notification idempotency ledger. A sender must first win the unique
 * (meeting, participant, kind, schedule_version) row via INSERT .. ON CONFLICT
 * DO NOTHING; only the winner delivers.
 */
export const meetingNotifications = pgTable(
  'meeting_notifications',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => meetingParticipants.id, { onDelete: 'cascade' }),
    kind: meetingNotificationKindEnum('kind').notNull(),
    scheduleVersion: integer('schedule_version').notNull().default(1),
    status: meetingNotificationStatusEnum('status').notNull().default('claimed'),
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => ({
    uniqueKindIdx: uniqueIndex('meeting_notification_unique_idx').on(
      table.meetingId,
      table.participantId,
      table.kind,
      table.scheduleVersion
    ),
    statusIdx: index('meeting_notification_status_idx').on(table.status, table.claimedAt),
  })
);

/**
 * Computed once when a meeting ends (recomputable). Columns are NULL when a
 * value cannot be derived reliably (e.g. nobody ever joined => no duration).
 * started_at/ended_at/host_id/org are denormalised so organisation dashboards
 * aggregate this table alone.
 */
export const meetingStats = pgTable(
  'meeting_stats',
  {
    meetingId: text('meeting_id')
      .primaryKey()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    hostId: text('host_id').notNull(),
    isRecurring: boolean('is_recurring').notNull().default(false),
    hasExternalGuests: boolean('has_external_guests').notNull().default(false),
    /** First attendance-session start; NULL if the meeting never had anyone in it. */
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds'),
    invitedCount: integer('invited_count').notNull().default(0),
    attendedCount: integer('attended_count').notNull().default(0),
    noShowCount: integer('no_show_count').notNull().default(0),
    peakConcurrent: integer('peak_concurrent').notNull().default(0),
    totalParticipantSeconds: integer('total_participant_seconds').notNull().default(0),
    avgAttendanceSeconds: integer('avg_attendance_seconds'),
    avgAttendancePct: real('avg_attendance_pct'),
    lateArrivals: integer('late_arrivals').notNull().default(0),
    earlyDepartures: integer('early_departures').notNull().default(0),
    totalJoins: integer('total_joins').notNull().default(0),
    totalLeaves: integer('total_leaves').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStartedIdx: index('meeting_stats_org_started_idx').on(table.organizationId, table.startedAt),
    orgScheduledIdx: index('meeting_stats_org_scheduled_idx').on(
      table.organizationId,
      table.scheduledStartAt
    ),
    hostIdx: index('meeting_stats_host_idx').on(table.organizationId, table.hostId),
  })
);

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type MeetingSeries = typeof meetingSeries.$inferSelect;
export type MeetingParticipant = typeof meetingParticipants.$inferSelect;
export type MeetingAttendanceSession = typeof meetingAttendanceSessions.$inferSelect;
export type MeetingStats = typeof meetingStats.$inferSelect;
