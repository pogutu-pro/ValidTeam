-- Meetings: first-class, project-independent meetings with recurrence, guests,
-- attendance sessions, notification idempotency ledger and computed stats.
-- Idempotent: safe to re-run.

DO $$ BEGIN
  CREATE TYPE "meeting_status" AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "meeting_participant_role" AS ENUM ('host', 'participant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "meeting_access" AS ENUM ('invited', 'organization');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "meeting_media_feature_status" AS ENUM ('none', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "meeting_notification_kind" AS ENUM ('invitation', 'reminder_30m', 'no_show_30m', 'summary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "meeting_notification_status" AS ENUM ('claimed', 'sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "meeting_series" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "host_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "timezone" varchar(100) NOT NULL,
  "anchor_start_at" timestamptz NOT NULL,
  "duration_minutes" integer NOT NULL,
  "rule" jsonb NOT NULL,
  "participant_template" jsonb NOT NULL DEFAULT '{}',
  "access" "meeting_access" NOT NULL DEFAULT 'invited',
  "allow_guests" boolean NOT NULL DEFAULT true,
  "generated_through" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "meeting_series_org_idx" ON "meeting_series" ("organization_id");
CREATE INDEX IF NOT EXISTS "meeting_series_active_idx" ON "meeting_series" ("cancelled_at", "generated_through");

CREATE TABLE IF NOT EXISTS "meetings" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" varchar(40) NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "series_id" text REFERENCES "meeting_series"("id") ON DELETE CASCADE,
  "occurrence_key" varchar(10),
  "host_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "description" text,
  "status" "meeting_status" NOT NULL DEFAULT 'scheduled',
  "is_instant" boolean NOT NULL DEFAULT false,
  "access" "meeting_access" NOT NULL DEFAULT 'invited',
  "allow_guests" boolean NOT NULL DEFAULT true,
  "timezone" varchar(100) NOT NULL,
  "scheduled_start_at" timestamptz NOT NULL,
  "scheduled_end_at" timestamptz NOT NULL,
  "schedule_version" integer NOT NULL DEFAULT 1,
  "actual_started_at" timestamptz,
  "ended_at" timestamptz,
  "ended_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "end_reason" varchar(40),
  "cancelled_at" timestamptz,
  "livekit_room_name" varchar(255),
  "recording_status" "meeting_media_feature_status" NOT NULL DEFAULT 'none',
  "transcription_status" "meeting_media_feature_status" NOT NULL DEFAULT 'none',
  "caption_status" "meeting_media_feature_status" NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meeting_ends_after_start" CHECK ("scheduled_end_at" > "scheduled_start_at")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_slug_idx" ON "meetings" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_livekit_room_idx" ON "meetings" ("livekit_room_name");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_series_occurrence_idx" ON "meetings" ("series_id", "occurrence_key");
CREATE INDEX IF NOT EXISTS "meeting_org_scheduled_idx" ON "meetings" ("organization_id", "scheduled_start_at");
CREATE INDEX IF NOT EXISTS "meeting_org_status_scheduled_idx" ON "meetings" ("organization_id", "status", "scheduled_start_at");
CREATE INDEX IF NOT EXISTS "meeting_host_idx" ON "meetings" ("host_id", "scheduled_start_at");
CREATE INDEX IF NOT EXISTS "meeting_status_scheduled_idx" ON "meetings" ("status", "scheduled_start_at");
CREATE INDEX IF NOT EXISTS "meeting_org_ended_idx" ON "meetings" ("organization_id", "ended_at");

CREATE TABLE IF NOT EXISTS "meeting_participants" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "guest_email" varchar(320),
  "guest_name" varchar(200),
  "role" "meeting_participant_role" NOT NULL DEFAULT 'participant',
  "removed_at" timestamptz,
  "removed_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "stats_computed_at" timestamptz,
  "first_joined_at" timestamptz,
  "last_left_at" timestamptz,
  "attended_seconds" integer,
  "attendance_pct" real,
  "join_count" integer,
  "leave_count" integer,
  "late_arrival" boolean,
  "early_departure" boolean,
  "no_show" boolean,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meeting_participant_one_identity" CHECK (("user_id" IS NOT NULL) <> ("guest_email" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_participant_meeting_user_idx" ON "meeting_participants" ("meeting_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_participant_meeting_guest_idx" ON "meeting_participants" ("meeting_id", "guest_email");
CREATE INDEX IF NOT EXISTS "meeting_participant_user_idx" ON "meeting_participants" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "meeting_participant_meeting_idx" ON "meeting_participants" ("meeting_id");

CREATE TABLE IF NOT EXISTS "meeting_guest_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "participant_id" text NOT NULL REFERENCES "meeting_participants"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_guest_token_hash_idx" ON "meeting_guest_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "meeting_guest_token_participant_idx" ON "meeting_guest_tokens" ("participant_id");

CREATE TABLE IF NOT EXISTS "meeting_attendance_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "participant_id" text NOT NULL REFERENCES "meeting_participants"("id") ON DELETE CASCADE,
  "identity" varchar(255) NOT NULL,
  "joined_at" timestamptz NOT NULL,
  "left_at" timestamptz,
  "leave_reason" varchar(40),
  "source" varchar(20) NOT NULL DEFAULT 'webhook',
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meeting_attendance_left_after_join" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at")
);
CREATE INDEX IF NOT EXISTS "meeting_attendance_meeting_participant_idx" ON "meeting_attendance_sessions" ("meeting_id", "participant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_attendance_open_identity_idx" ON "meeting_attendance_sessions" ("meeting_id", "identity") WHERE "left_at" IS NULL;
CREATE INDEX IF NOT EXISTS "meeting_attendance_open_idx" ON "meeting_attendance_sessions" ("meeting_id") WHERE "left_at" IS NULL;
CREATE INDEX IF NOT EXISTS "meeting_attendance_org_joined_idx" ON "meeting_attendance_sessions" ("organization_id", "joined_at");

CREATE TABLE IF NOT EXISTS "meeting_events" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "participant_id" text REFERENCES "meeting_participants"("id") ON DELETE SET NULL,
  "type" varchar(50) NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "data" jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "meeting_event_meeting_idx" ON "meeting_events" ("meeting_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "meeting_event_org_type_idx" ON "meeting_events" ("organization_id", "type", "occurred_at");

CREATE TABLE IF NOT EXISTS "meeting_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "participant_id" text NOT NULL REFERENCES "meeting_participants"("id") ON DELETE CASCADE,
  "kind" "meeting_notification_kind" NOT NULL,
  "schedule_version" integer NOT NULL DEFAULT 1,
  "status" "meeting_notification_status" NOT NULL DEFAULT 'claimed',
  "attempts" integer NOT NULL DEFAULT 1,
  "error" text,
  "claimed_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_notification_unique_idx" ON "meeting_notifications" ("meeting_id", "participant_id", "kind", "schedule_version");
CREATE INDEX IF NOT EXISTS "meeting_notification_status_idx" ON "meeting_notifications" ("status", "claimed_at");

CREATE TABLE IF NOT EXISTS "meeting_stats" (
  "meeting_id" text PRIMARY KEY NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "host_id" text NOT NULL,
  "is_recurring" boolean NOT NULL DEFAULT false,
  "has_external_guests" boolean NOT NULL DEFAULT false,
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "scheduled_start_at" timestamptz NOT NULL,
  "duration_seconds" integer,
  "invited_count" integer NOT NULL DEFAULT 0,
  "attended_count" integer NOT NULL DEFAULT 0,
  "no_show_count" integer NOT NULL DEFAULT 0,
  "peak_concurrent" integer NOT NULL DEFAULT 0,
  "total_participant_seconds" integer NOT NULL DEFAULT 0,
  "avg_attendance_seconds" integer,
  "avg_attendance_pct" real,
  "late_arrivals" integer NOT NULL DEFAULT 0,
  "early_departures" integer NOT NULL DEFAULT 0,
  "total_joins" integer NOT NULL DEFAULT 0,
  "total_leaves" integer NOT NULL DEFAULT 0,
  "computed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "meeting_stats_org_started_idx" ON "meeting_stats" ("organization_id", "started_at");
CREATE INDEX IF NOT EXISTS "meeting_stats_org_scheduled_idx" ON "meeting_stats" ("organization_id", "scheduled_start_at");
CREATE INDEX IF NOT EXISTS "meeting_stats_host_idx" ON "meeting_stats" ("organization_id", "host_id");

-- Per-event email preferences for meetings (on by default, like every other event).
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_on_meeting_invite" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_on_meeting_reminder" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_on_meeting_no_show" boolean NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "email_on_meeting_summary" boolean NOT NULL DEFAULT true;
