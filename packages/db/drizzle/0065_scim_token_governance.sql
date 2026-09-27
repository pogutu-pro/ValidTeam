-- Fast, least-privilege SCIM token lookup and human lifecycle attribution.
-- Existing tokens retain NULL digest/prefix/creator values and continue to
-- authenticate through the bounded legacy fallback until administrators
-- rotate them.

ALTER TABLE "scim_tokens"
  ADD COLUMN IF NOT EXISTS "token_digest" text,
  ADD COLUMN IF NOT EXISTS "token_prefix" text,
  ADD COLUMN IF NOT EXISTS "created_by" text;

ALTER TABLE "scim_tokens"
  ALTER COLUMN "scopes"
  SET DEFAULT ARRAY['users:read', 'users:write', 'groups:read', 'groups:write']::text[];

DO $$ BEGIN
  ALTER TABLE "scim_tokens"
    ADD CONSTRAINT "scim_tokens_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "scim_tokens"
    ADD CONSTRAINT "scim_tokens_scopes_check"
    CHECK (
      "scopes" <@ ARRAY['users:read', 'users:write', 'groups:read', 'groups:write']::text[]
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "scim_tokens_token_digest_idx"
  ON "scim_tokens" USING btree ("token_digest")
  WHERE "token_digest" IS NOT NULL;

ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'scim_token.created';
ALTER TYPE "audit_log_action" ADD VALUE IF NOT EXISTS 'scim_token.revoked';
