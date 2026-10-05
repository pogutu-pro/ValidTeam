import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Integration Connections
 *
 * Shared OAuth connection store for third-party integrations (Slack, GitLab,
 * Jira, Sentry, etc.). One row per (organization, provider) — provider-specific
 * extras live in `metadata`, tokens are stored as encrypted AES-256-GCM
 * envelopes in `accessTokenEnc` / `refreshTokenEnc`.
 *
 * This schema is intentionally generic so other integrations can reuse it
 * without bespoke per-provider tables.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    // Short provider key: 'slack', 'gitlab', 'jira', 'sentry', etc.
    provider: text('provider').notNull(),

    // Provider-side identifiers (e.g. Slack workspace/team id, GitLab user id).
    externalAccountId: text('external_account_id'),
    externalAccountLabel: text('external_account_label'),

    // Encrypted envelope: { iv, authTag, ciphertext } (base64).
    accessTokenEnc: jsonb('access_token_enc'),
    refreshTokenEnc: jsonb('refresh_token_enc'),

    // Granted OAuth scope string, space-separated as returned by provider.
    scope: text('scope'),

    // Free-form provider specific extras (bot user id, enterprise id, etc.).
    metadata: jsonb('metadata').notNull().default('{}'),

    connectedById: text('connected_by_id').references(() => users.id),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    orgProviderIdx: uniqueIndex('integration_connections_org_provider_idx').on(
      table.organizationId,
      table.provider
    ),
    // Incoming Slack webhooks identify only the Slack workspace (`team_id`).
    // Make that identity globally unambiguous so an event can never be routed
    // to an arbitrary ValidTeam organization.
    slackWorkspaceIdx: uniqueIndex('integration_connections_slack_workspace_idx')
      .on(table.externalAccountId)
      .where(sql`${table.provider} = 'slack' AND ${table.externalAccountId} IS NOT NULL`),
    organizationIdx: index('integration_connections_organization_idx').on(table.organizationId),
    providerIdx: index('integration_connections_provider_idx').on(table.provider),
  })
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection = typeof integrationConnections.$inferInsert;
