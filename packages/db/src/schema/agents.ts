import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { projects } from './projects';
import { users } from './users';

export const agentRunKindEnum = pgEnum('agent_run_kind', [
  'project_tracking',
  'backlog_triage',
  'sprint_planning',
  'bulk_sprint_creation',
]);

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const agentExecutionModeEnum = pgEnum('agent_execution_mode', [
  'manual',
  'assistive',
  'auto',
]);

export const agentProviderEnum = pgEnum('agent_provider', [
  'native',
  'openai',
  'anthropic',
  'azure',
  'custom',
]);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    initiatedBy: text('initiated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: agentRunKindEnum('kind').notNull(),
    status: agentRunStatusEnum('status').notNull().default('pending'),
    mode: agentExecutionModeEnum('mode').notNull().default('manual'),
    dryRun: boolean('dry_run').notNull().default(false),
    summary: text('summary'),
    writeActionsCount: integer('write_actions_count').notNull().default(0),
    input: jsonb('input').notNull().default('{}'),
    output: jsonb('output').notNull().default('{}'),
    logs: jsonb('logs').notNull().default('[]'),
    error: text('error'),

    // Durable bounded-graph state. `checkpointVersion` is a compare-and-set
    // fence: only the current lease holder may advance a checkpoint.
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    requestHash: varchar('request_hash', { length: 64 }),
    graphVersion: varchar('graph_version', { length: 64 }),
    currentNode: varchar('current_node', { length: 64 }),
    checkpoint: jsonb('checkpoint'),
    checkpointVersion: integer('checkpoint_version').notNull().default(0),
    completedSteps: integer('completed_steps').notNull().default(0),
    lastEventSequence: integer('last_event_sequence').notNull().default(0),
    maxSteps: integer('max_steps').notNull().default(6),
    maxVisitsPerNode: integer('max_visits_per_node').notNull().default(2),
    maxRuntimeMs: integer('max_runtime_ms').notNull().default(120000),
    maxConsecutiveNoProgress: integer('max_consecutive_no_progress').notNull().default(2),
    deadlineAt: timestamp('deadline_at'),

    // Recoverable worker lease and cooperative cancellation fields.
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    heartbeatAt: timestamp('heartbeat_at'),
    cancelRequestedAt: timestamp('cancel_requested_at'),

    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index('agent_run_organization_idx').on(table.organizationId),
    projectIdx: index('agent_run_project_idx').on(table.projectId),
    statusIdx: index('agent_run_status_idx').on(table.status),
    kindIdx: index('agent_run_kind_idx').on(table.kind),
    createdAtIdx: index('agent_run_created_at_idx').on(table.createdAt),
    projectCreatedAtIdx: index('agent_run_project_created_at_idx').on(
      table.projectId,
      table.createdAt
    ),
    orgIdempotencyIdx: uniqueIndex('agent_run_org_idempotency_idx').on(
      table.organizationId,
      table.idempotencyKey
    ),
    recoverableIdx: index('agent_run_recoverable_idx').on(
      table.status,
      table.leaseExpiresAt,
      table.createdAt
    ),
  })
);

/** Append-only durable graph lifecycle and node-attempt events. */
export const agentRunStepEvents = pgTable(
  'agent_run_step_events',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    node: varchar('node', { length: 64 }),
    step: integer('step').notNull().default(0),
    attempt: integer('attempt'),
    payload: jsonb('payload').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    runSequenceIdx: uniqueIndex('agent_run_step_event_run_sequence_idx').on(
      table.runId,
      table.sequence
    ),
    organizationIdx: index('agent_run_step_event_organization_idx').on(
      table.organizationId,
      table.createdAt
    ),
    projectIdx: index('agent_run_step_event_project_idx').on(table.projectId, table.createdAt),
    runIdx: index('agent_run_step_event_run_idx').on(table.runId, table.createdAt),
  })
);

/**
 * Transactional idempotency receipts for domain writes performed by a graph
 * node. The receipt and its mutation commit together; a resumed node skips a
 * completed effect with the same stable key.
 */
export const agentRunEffects = pgTable(
  'agent_run_effects',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    effectKey: varchar('effect_key', { length: 255 }).notNull(),
    effectType: varchar('effect_type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    runEffectIdx: uniqueIndex('agent_run_effect_run_key_idx').on(table.runId, table.effectKey),
    organizationIdx: index('agent_run_effect_organization_idx').on(
      table.organizationId,
      table.createdAt
    ),
    projectIdx: index('agent_run_effect_project_idx').on(table.projectId, table.createdAt),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentRunStepEvent = typeof agentRunStepEvents.$inferSelect;
export type AgentRunEffect = typeof agentRunEffects.$inferSelect;

export const agentModelConfigs = pgTable(
  'agent_model_configs',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    provider: agentProviderEnum('provider').notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    description: text('description'),
    settings: jsonb('settings').notNull().default('{}'),
    isDefault: boolean('is_default').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index('agent_model_config_organization_idx').on(table.organizationId),
    providerIdx: index('agent_model_config_provider_idx').on(table.provider),
    defaultIdx: index('agent_model_config_default_idx').on(table.organizationId, table.isDefault),
    activeIdx: index('agent_model_config_active_idx').on(table.organizationId, table.isArchived),
    orgNameIdx: uniqueIndex('agent_model_config_org_name_idx').on(table.organizationId, table.name),
  })
);

export const agentModelConfigRevisions = pgTable(
  'agent_model_config_revisions',
  {
    id: text('id')
      .$defaultFn(() => createId())
      .primaryKey(),
    configId: text('config_id')
      .notNull()
      .references(() => agentModelConfigs.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull().default('{}'),
    changedBy: text('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    configIdx: index('agent_model_config_revision_config_idx').on(table.configId),
    orgIdx: index('agent_model_config_revision_org_idx').on(table.organizationId),
    configRevisionIdx: uniqueIndex('agent_model_config_revision_unique_idx').on(
      table.configId,
      table.revision
    ),
  })
);
