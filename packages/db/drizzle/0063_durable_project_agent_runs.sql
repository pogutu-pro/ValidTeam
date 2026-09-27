-- Durable execution state for the bounded project-agent graph.
--
-- Existing agent_runs rows remain readable. New runs receive an idempotency
-- key, a versioned checkpoint and a recoverable worker lease. Step events are
-- append-only; effect receipts commit in the same transaction as domain writes
-- so a resumed execute node does not repeat a completed mutation.

ALTER TYPE "agent_run_status" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'agent.run_cancelled';

ALTER TABLE IF EXISTS "agent_runs"
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128),
  ADD COLUMN IF NOT EXISTS "request_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "graph_version" varchar(64),
  ADD COLUMN IF NOT EXISTS "current_node" varchar(64),
  ADD COLUMN IF NOT EXISTS "checkpoint" jsonb,
  ADD COLUMN IF NOT EXISTS "checkpoint_version" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "completed_steps" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_event_sequence" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_steps" integer DEFAULT 6 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_visits_per_node" integer DEFAULT 2 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_runtime_ms" integer DEFAULT 120000 NOT NULL,
  ADD COLUMN IF NOT EXISTS "max_consecutive_no_progress" integer DEFAULT 2 NOT NULL,
  ADD COLUMN IF NOT EXISTS "deadline_at" timestamp,
  ADD COLUMN IF NOT EXISTS "lease_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp,
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp;

-- Rows created by the pre-graph synchronous engine have no resumable
-- checkpoint or durable input snapshot. Failing them explicitly is safer than
-- pretending they can be recovered by the new worker.
UPDATE "agent_runs"
SET
  "status" = 'failed',
  "error" = 'legacy run interrupted by durable runtime upgrade',
  "summary" = NULL,
  "output" = jsonb_build_object(
    'error', 'legacy run interrupted by durable runtime upgrade',
    'errorCode', 'legacy_runtime_upgrade'
  ),
  "completed_at" = COALESCE("completed_at", now()),
  "updated_at" = now()
WHERE "graph_version" IS NULL
  AND "status" IN ('pending', 'running');

DO $$ BEGIN
  ALTER TABLE "agent_runs"
    ADD CONSTRAINT "agent_run_graph_bounds_check"
    CHECK (
      "checkpoint_version" >= 0 AND
      "completed_steps" >= 0 AND
      "last_event_sequence" >= 0 AND
      "max_steps" > 0 AND
      "max_visits_per_node" > 0 AND
      "max_runtime_ms" > 0 AND
      "max_consecutive_no_progress" > 0
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_org_idempotency_idx"
  ON "agent_runs" ("organization_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_run_recoverable_idx"
  ON "agent_runs" ("status", "lease_expires_at", "created_at");

CREATE TABLE IF NOT EXISTS "agent_run_step_events" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text,
  "run_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "node" varchar(64),
  "step" integer DEFAULT 0 NOT NULL,
  "attempt" integer,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "agent_run_step_events"
    ADD CONSTRAINT "agent_run_step_event_organization_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_run_step_events"
    ADD CONSTRAINT "agent_run_step_event_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_run_step_events"
    ADD CONSTRAINT "agent_run_step_event_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_step_event_run_sequence_idx"
  ON "agent_run_step_events" ("run_id", "sequence");
CREATE INDEX IF NOT EXISTS "agent_run_step_event_organization_idx"
  ON "agent_run_step_events" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_run_step_event_project_idx"
  ON "agent_run_step_events" ("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_run_step_event_run_idx"
  ON "agent_run_step_events" ("run_id", "created_at");

CREATE TABLE IF NOT EXISTS "agent_run_effects" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text,
  "run_id" text NOT NULL,
  "effect_key" varchar(255) NOT NULL,
  "effect_type" varchar(64) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "agent_run_effects"
    ADD CONSTRAINT "agent_run_effect_organization_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_run_effects"
    ADD CONSTRAINT "agent_run_effect_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_run_effects"
    ADD CONSTRAINT "agent_run_effect_run_fk"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_effect_run_key_idx"
  ON "agent_run_effects" ("run_id", "effect_key");
CREATE INDEX IF NOT EXISTS "agent_run_effect_organization_idx"
  ON "agent_run_effects" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_run_effect_project_idx"
  ON "agent_run_effects" ("project_id", "created_at");
