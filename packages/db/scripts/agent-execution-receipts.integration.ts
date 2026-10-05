/**
 * Real-Postgres verification for migration 0061.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://... pnpm --filter @validteam/db \
 *     test:integration:agent-execution-receipts
 *
 * The target database must already have the repository migrations applied.
 * Fixtures are isolated by random ids and removed on completion.
 */

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; refusing to run against an implicit database');
}

const sql = postgres(databaseUrl, { max: 4 });
const suffix = randomUUID().replaceAll('-', '');
const ids = {
  organization: `it_org_${suffix}`,
  user: `it_user_${suffix}`,
  project: `it_project_${suffix}`,
  workflow: `it_workflow_${suffix}`,
  status: `it_status_${suffix}`,
  issue: `it_issue_${suffix}`,
  session: `it_session_${suffix}`,
  approval: `it_approval_${suffix}`,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const [constraint] = await sql<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition
      from pg_constraint
     where conrelid = 'agent_approval_requests'::regclass
       and conname = 'agent_approval_status_check'
  `;
  assert(constraint?.definition.includes('executing'), 'approval CHECK is missing executing');
  assert(constraint.definition.includes('failed'), 'approval CHECK is missing failed');

  await sql.begin(async (tx) => {
    await tx`
      insert into organizations (id, name, slug)
      values (${ids.organization}, 'Execution receipt integration', ${`receipt-${suffix}`})
    `;
    await tx`
      insert into users (id, email)
      values (${ids.user}, ${`receipt-${suffix}@example.test`})
    `;
    await tx`
      insert into projects (id, organization_id, key, name, created_by, updated_by)
      values (${ids.project}, ${ids.organization}, 'ITR', 'Receipt integration', ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into workflows (id, organization_id, name, is_default, created_by, updated_by)
      values (${ids.workflow}, ${ids.organization}, 'Integration workflow', true, ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into workflow_statuses (id, workflow_id, name, category, color, position)
      values (${ids.status}, ${ids.workflow}, 'Backlog', 'backlog', '#000000', 0)
    `;
    await tx`
      insert into issues (
        id, organization_id, project_id, key, number, type, title, status_id,
        reporter_id, created_by, updated_by
      ) values (
        ${ids.issue}, ${ids.organization}, ${ids.project}, 'ITR-1', 1, 'task',
        'Execution receipt integration', ${ids.status}, ${ids.user}, ${ids.user}, ${ids.user}
      )
    `;
    await tx`
      insert into agent_sessions (id, issue_id, provider, signed_secret)
      values (${ids.session}, ${ids.issue}, 'cursor', 'integration-secret')
    `;
    await tx`
      insert into agent_approval_requests (
        id, workspace_id, project_id, requested_by, actor, resource, action,
        target_type, target_id, decision_reason
      ) values (
        ${ids.approval}, ${ids.organization}, ${ids.project}, ${ids.user}, 'agent:codex',
        'issues', 'update', 'issue', ${ids.issue}, 'integration verification'
      )
    `;
  });

  try {
    await sql`
      update agent_approval_requests set status = 'executing' where id = ${ids.approval}
    `;
    await sql`
      update agent_approval_requests set status = 'failed' where id = ${ids.approval}
    `;

    let invalidStatusRejected = false;
    try {
      await sql`
        update agent_approval_requests set status = 'not-a-real-state' where id = ${ids.approval}
      `;
    } catch {
      invalidStatusRejected = true;
    }
    assert(invalidStatusRejected, 'approval status CHECK accepted an unknown state');

    const fingerprint = 'a'.repeat(64);
    const receiptAttempts = await Promise.all([
      sql`
        insert into agent_session_webhook_deliveries (
          id, workspace_id, session_id, provider, fingerprint, event_state, payload
        ) values (
          ${`it_delivery_a_${suffix}`}, ${ids.organization}, ${ids.session}, 'cursor',
          ${fingerprint}, 'active', '{}'::jsonb
        ) on conflict do nothing returning id
      `,
      sql`
        insert into agent_session_webhook_deliveries (
          id, workspace_id, session_id, provider, fingerprint, event_state, payload
        ) values (
          ${`it_delivery_b_${suffix}`}, ${ids.organization}, ${ids.session}, 'cursor',
          ${fingerprint}, 'active', '{}'::jsonb
        ) on conflict do nothing returning id
      `,
    ]);
    assert(
      receiptAttempts.reduce((count, rows) => count + rows.length, 0) === 1,
      'concurrent webhook fingerprint inserts did not produce exactly one receipt'
    );

    const outboxAttempts = await Promise.all([
      sql`
        insert into agent_approval_effect_outbox (
          id, approval_id, workspace_id, effect_type, payload
        ) values (
          ${`it_effect_a_${suffix}`}, ${ids.approval}, ${ids.organization},
          'issue.updated', '{}'::jsonb
        ) on conflict do nothing returning id
      `,
      sql`
        insert into agent_approval_effect_outbox (
          id, approval_id, workspace_id, effect_type, payload
        ) values (
          ${`it_effect_b_${suffix}`}, ${ids.approval}, ${ids.organization},
          'issue.updated', '{}'::jsonb
        ) on conflict do nothing returning id
      `,
    ]);
    assert(
      outboxAttempts.reduce((count, rows) => count + rows.length, 0) === 1,
      'concurrent approval effect inserts did not produce exactly one outbox row'
    );
  } finally {
    await sql`delete from organizations where id = ${ids.organization}`;
    await sql`delete from users where id = ${ids.user}`;
  }
}

main()
  .then(() => {
    console.log('agent execution receipt integration checks passed');
  })
  .finally(() => sql.end());
