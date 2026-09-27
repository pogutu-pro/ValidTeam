-- Slack Events API, slash commands, and interactive payloads identify the
-- installation by team_id alone. A Slack workspace therefore must belong to
-- exactly one TaskNebula organization; otherwise inbound events are
-- ambiguous and could cross tenant boundaries.
--
-- Fail loudly when a pre-existing database already contains ambiguous rows.
-- Choosing or deleting one connection automatically would be destructive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "integration_connections"
    WHERE "provider" = 'slack' AND "external_account_id" IS NOT NULL
    GROUP BY "external_account_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce Slack workspace identity: duplicate Slack external_account_id values exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_slack_workspace_idx"
  ON "integration_connections" ("external_account_id")
  WHERE "provider" = 'slack' AND "external_account_id" IS NOT NULL;
