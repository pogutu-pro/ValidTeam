-- Turn every event email on by default. Idempotent.
ALTER TABLE "notification_preferences" ALTER COLUMN "email_on_commented" SET DEFAULT true;
ALTER TABLE "notification_preferences" ALTER COLUMN "email_on_status_changed" SET DEFAULT true;
ALTER TABLE "notification_preferences" ALTER COLUMN "email_on_issue_created" SET DEFAULT true;
ALTER TABLE "notification_preferences" ALTER COLUMN "email_on_project_created" SET DEFAULT true;
ALTER TABLE "notification_preferences" ALTER COLUMN "email_on_project_archived" SET DEFAULT true;

-- Backfill auto-created rows that were never edited (created_at = updated_at)
-- so those users also receive the newly enabled emails. Rows a user has saved
-- themselves keep their explicit choices.
UPDATE "notification_preferences"
SET "email_on_commented" = true,
    "email_on_status_changed" = true,
    "email_on_issue_created" = true,
    "email_on_project_created" = true,
    "email_on_project_archived" = true
WHERE "created_at" = "updated_at";
