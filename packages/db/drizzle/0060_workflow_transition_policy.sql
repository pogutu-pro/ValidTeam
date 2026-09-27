-- Persist the policy fields already exposed by the workflow builder.
-- Enforcement is intentionally a separate application-service rollout; this
-- migration prevents role/approval configuration from disappearing on save.

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "allowed_roles" jsonb NOT NULL DEFAULT '["admin","member"]'::jsonb;

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "requires_approval" boolean NOT NULL DEFAULT false;

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "approver_roles" jsonb NOT NULL DEFAULT '["admin"]'::jsonb;

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "approved_target_status_id" text;

ALTER TABLE "workflow_transitions"
  ADD COLUMN IF NOT EXISTS "rejected_target_status_id" text;

DO $$
BEGIN
  ALTER TABLE "workflow_transitions"
    ADD CONSTRAINT "workflow_transitions_approved_target_status_id_workflow_statuses_id_fk"
    FOREIGN KEY ("approved_target_status_id")
    REFERENCES "workflow_statuses"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "workflow_transitions"
    ADD CONSTRAINT "workflow_transitions_rejected_target_status_id_workflow_statuses_id_fk"
    FOREIGN KEY ("rejected_target_status_id")
    REFERENCES "workflow_statuses"("id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
