-- Durable agent execution receipts.
--
-- 1. Expand approval lifecycle states used by the atomic claim/apply path.
-- 2. Persist inbound agent-session webhook fingerprints as the concurrency gate.
-- 3. Persist approval post-commit effects in a leased, retryable outbox.

ALTER TABLE IF EXISTS "agent_approval_requests"
  DROP CONSTRAINT IF EXISTS "agent_approval_status_check";

DO $$ BEGIN
  IF to_regclass('public.agent_approval_requests') IS NOT NULL THEN
    ALTER TABLE "agent_approval_requests"
      ADD CONSTRAINT "agent_approval_status_check"
      CHECK ("status" IN ('pending', 'executing', 'approved', 'rejected', 'expired', 'failed'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "agent_session_webhook_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "session_id" text NOT NULL,
  "provider" "agent_session_provider" NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "event_state" "agent_session_state" NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'processing' NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "agent_session_webhook_deliveries"
    ADD CONSTRAINT "agent_session_webhook_delivery_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_session_webhook_deliveries"
    ADD CONSTRAINT "agent_session_webhook_delivery_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_session_webhook_deliveries"
    ADD CONSTRAINT "agent_session_webhook_delivery_status_check"
    CHECK ("status" IN ('processing', 'completed', 'dropped', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "agent_session_webhook_delivery_workspace_idx"
  ON "agent_session_webhook_deliveries" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_session_webhook_delivery_session_idx"
  ON "agent_session_webhook_deliveries" ("session_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_webhook_delivery_session_fingerprint_idx"
  ON "agent_session_webhook_deliveries" ("workspace_id", "session_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "agent_session_webhook_delivery_status_idx"
  ON "agent_session_webhook_deliveries" ("workspace_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "agent_approval_effect_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "approval_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "effect_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp DEFAULT now() NOT NULL,
  "locked_at" timestamp,
  "lock_token" text,
  "completed_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "agent_approval_effect_outbox"
    ADD CONSTRAINT "agent_approval_effect_approval_fk"
    FOREIGN KEY ("approval_id") REFERENCES "agent_approval_requests"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_approval_effect_outbox"
    ADD CONSTRAINT "agent_approval_effect_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "agent_approval_effect_outbox"
    ADD CONSTRAINT "agent_approval_effect_status_check"
    CHECK ("status" IN ('pending', 'processing', 'completed', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_approval_effect_approval_type_idx"
  ON "agent_approval_effect_outbox" ("approval_id", "effect_type");
CREATE INDEX IF NOT EXISTS "agent_approval_effect_workspace_status_idx"
  ON "agent_approval_effect_outbox" ("workspace_id", "status", "available_at");
CREATE INDEX IF NOT EXISTS "agent_approval_effect_lease_idx"
  ON "agent_approval_effect_outbox" ("status", "locked_at");
