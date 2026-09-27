/** Real-Postgres verification for migration 0063 and its concurrency fences. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; refusing to run against an implicit database');
}

const sql = postgres(databaseUrl, { max: 4 });
const suffix = randomUUID().replaceAll('-', '');
const ids = {
  organization: `graph_org_${suffix}`,
  user: `graph_user_${suffix}`,
  project: `graph_project_${suffix}`,
  workflow: `graph_workflow_${suffix}`,
  status: `graph_status_${suffix}`,
  issue: `graph_issue_${suffix}`,
  run: `graph_run_${suffix}`,
  legacy: `graph_legacy_${suffix}`,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await sql.begin(async (tx) => {
    await tx`insert into organizations (id, name, slug) values (${ids.organization}, 'Graph integration', ${`graph-${suffix}`})`;
    await tx`insert into users (id, email) values (${ids.user}, ${`graph-${suffix}@example.test`})`;
    await tx`
      insert into projects (id, organization_id, key, name, created_by, updated_by)
      values (${ids.project}, ${ids.organization}, 'GRA', 'Graph integration', ${ids.user}, ${ids.user})
    `;
    await tx`
      insert into workflows (id, organization_id, name, is_default, created_by, updated_by)
      values (${ids.workflow}, ${ids.organization}, 'Graph workflow', true, ${ids.user}, ${ids.user})
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
        ${ids.issue}, ${ids.organization}, ${ids.project}, 'GRA-1', 1, 'task',
        'Graph fencing target', ${ids.status}, ${ids.user}, ${ids.user}, ${ids.user}
      )
    `;
  });

  try {
    const duplicateAttempts = await Promise.all([
      sql`
        insert into agent_runs (
          id, organization_id, project_id, initiated_by, kind, status,
          idempotency_key, request_hash, graph_version, current_node, deadline_at
        ) values (
          ${ids.run}, ${ids.organization}, ${ids.project}, ${ids.user},
          'backlog_triage', 'pending', 'same-request', ${'a'.repeat(64)},
          'project-agent-v1', 'load_context', now() + interval '10 minutes'
        ) on conflict do nothing returning id
      `,
      sql`
        insert into agent_runs (
          id, organization_id, project_id, initiated_by, kind, status,
          idempotency_key, request_hash, graph_version, current_node, deadline_at
        ) values (
          ${`${ids.run}_duplicate`}, ${ids.organization}, ${ids.project}, ${ids.user},
          'backlog_triage', 'pending', 'same-request', ${'a'.repeat(64)},
          'project-agent-v1', 'load_context', now() + interval '10 minutes'
        ) on conflict do nothing returning id
      `,
    ]);
    assert(
      duplicateAttempts.reduce((total, rows) => total + rows.length, 0) === 1,
      'concurrent duplicate run requests created more than one row'
    );

    await sql`
      update agent_runs set status = 'running', lease_owner = 'new-worker',
        lease_expires_at = now() + interval '30 seconds'
      where id = ${ids.run}
    `;
    const fenced = async (worker: string, effectKey = 'triage:issue') =>
      sql.begin(async (tx) => {
        const owned = await tx`
          select id from agent_runs
          where id = ${ids.run} and organization_id = ${ids.organization}
            and project_id = ${ids.project} and status = 'running'
            and lease_owner = ${worker} and lease_expires_at > now()
            and cancel_requested_at is null
          for update
        `;
        if (owned.length === 0) return false;
        const receipt = await tx`
          insert into agent_run_effects (
            id, organization_id, project_id, run_id, effect_key, effect_type, payload
          ) values (
            ${`effect_${worker}_${suffix}`}, ${ids.organization}, ${ids.project},
            ${ids.run}, ${effectKey}, 'issue_triage', '{}'::jsonb
          ) on conflict do nothing returning id
        `;
        if (receipt.length === 0) return false;
        await tx`update issues set priority = 'high' where id = ${ids.issue} and organization_id = ${ids.organization} and project_id = ${ids.project}`;
        return true;
      });

    const effectWinners = await Promise.all([fenced('stale-worker'), fenced('new-worker')]);
    assert(effectWinners.filter(Boolean).length === 1, 'lease fencing allowed multiple workers');
    assert(effectWinners[1] === true, 'the current lease owner did not win the effect');
    const [effectCount] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_run_effects where run_id = ${ids.run}
    `;
    assert(effectCount?.total === 1, 'effect receipt was not exactly-once');

    await sql`
      update agent_runs set lease_owner = 'expired-worker',
        lease_expires_at = now() - interval '1 second'
      where id = ${ids.run}
    `;
    assert(
      (await fenced('expired-worker', 'triage:expired-owner')) === false,
      'an expired lease owner committed before reclaim'
    );

    const [baseline] = await sql<{ total: number }[]>`
      select count(*)::int as total from agent_runs where status in ('pending', 'running')
    `;
    const concurrencyLimit = (baseline?.total ?? 0) + 2;
    const admitted = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtext('project-agent-admission'))`;
          await tx`select pg_advisory_xact_lock(hashtext(${`project-agent-org:${ids.organization}`}))`;
          const [active] = await tx<{ total: number }[]>`
            select count(*)::int as total from agent_runs where status in ('pending', 'running')
          `;
          if ((active?.total ?? 0) >= concurrencyLimit) return false;
          await tx`
            insert into agent_runs (
              id, organization_id, project_id, initiated_by, kind, status,
              idempotency_key, request_hash, graph_version, current_node, deadline_at
            ) values (
              ${`admitted_${index}_${suffix}`}, ${ids.organization}, ${ids.project},
              ${ids.user}, 'project_tracking', 'pending', ${`admission-${index}`},
              ${String(index).padStart(64, '0')}, 'project-agent-v1', 'load_context',
              now() + interval '10 minutes'
            )
          `;
          return true;
        })
      )
    );
    assert(
      admitted.filter(Boolean).length === 2,
      'serialized admission exceeded or under-filled the concurrent limit'
    );

    await sql`
      insert into agent_runs (
        id, organization_id, project_id, initiated_by, kind, status
      ) values (
        ${ids.legacy}, ${ids.organization}, ${ids.project}, ${ids.user},
        'project_tracking', 'running'
      )
    `;
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0063_durable_project_agent_runs.sql'),
      'utf8'
    );
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    const [cancelledEnum] = await sql<{ value: string }[]>`
      select 'cancelled'::agent_run_status::text as value
    `;
    assert(cancelledEnum?.value === 'cancelled', 'agent run cancelled enum value is missing');
    const [legacy] = await sql<{ status: string; error: string | null }[]>`
      select status, error from agent_runs where id = ${ids.legacy}
    `;
    assert(legacy?.status === 'failed', 'legacy active run was stranded by migration');
    assert(
      legacy.error === 'legacy run interrupted by durable runtime upgrade',
      'legacy run failure reason is missing'
    );
  } finally {
    await sql`delete from organizations where id = ${ids.organization}`;
    await sql`delete from users where id = ${ids.user}`;
  }
}

main()
  .then(() => console.log('durable project agent run integration checks passed'))
  .finally(() => sql.end());
