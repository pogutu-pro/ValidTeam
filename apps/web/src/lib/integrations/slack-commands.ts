/**
 * Slash-command business logic for the Slack integration.
 *
 * The HTTP route at /api/integrations/slack/commands is intentionally thin —
 * it verifies the signature, parses form data, and hands the parsed verb here.
 * Each handler returns the response object Slack expects (we use the
 * `response_type` field to control private vs. in-channel replies).
 *
 * Handlers DO NOT call Slack APIs that require a delayed `response_url` —
 * Slack gives us 3 seconds for the initial reply, which is enough for the
 * queries we run (single-table lookups with appropriate indexes).
 */

import {
  db,
  eq,
  and,
  desc,
  inArray,
  ilike,
  ne,
  or,
  organizations,
  organizationMembers,
  integrationConnections,
  issues,
  users,
  workflowStatuses,
} from '@tasknebula/db';
import { createId } from '@paralleldrive/cuid2';
import { getTranslations } from 'next-intl/server';
import { callSlackApi, parseSlackUserMention, type ParsedSlashCommand } from './slack';
import { defaultLocale, isSupportedLocale, type Locale } from '@/lib/i18n/config';
import { triggerWebhooks } from '@/lib/webhooks/dispatcher';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import {
  applyPreparedIssueStatusTransition,
  isWorkflowTransitionError,
  prepareIssueStatusTransition,
  resolveProjectWorkflowStatusByCategory,
  WorkflowTransitionError,
} from '@/lib/workflows/issue-transition-policy';

export interface SlackCommandContext {
  /** Slack team/workspace id (from slash command form). */
  teamId: string;
  /** Slack channel id where the slash command was invoked. */
  channelId: string;
  /** Slack user id of the invoker. */
  slackUserId: string;
  /** Slack username (display) of the invoker. */
  slackUserName: string;
}

export interface SlackSlashResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: unknown[];
}

async function getSlackTranslator(locale: Locale) {
  return getTranslations({ locale, namespace: 'slackCommands' });
}

type SlackTranslator = Awaited<ReturnType<typeof getSlackTranslator>>;

function ephemeral(text: string, blocks?: unknown[]): SlackSlashResponse {
  return { response_type: 'ephemeral', text, ...(blocks ? { blocks } : {}) };
}

/**
 * Resolve the TaskNebula organization + connection row that owns a Slack
 * workspace. We look up by the workspace id stored in
 * `integration_connections.external_account_id`. Returns null when no org has
 * the bot installed.
 */
export async function resolveSlackOrg(teamId: string): Promise<{
  organizationId: string;
  connectionId: string;
  botUserId: string | null;
  locale: Locale;
} | null> {
  const rows = await db
    .select({
      organizationId: integrationConnections.organizationId,
      id: integrationConnections.id,
      metadata: integrationConnections.metadata,
      locale: users.locale,
    })
    .from(integrationConnections)
    .innerJoin(organizations, eq(organizations.id, integrationConnections.organizationId))
    .leftJoin(users, eq(users.id, integrationConnections.connectedById))
    .where(
      and(
        eq(integrationConnections.provider, 'slack'),
        eq(integrationConnections.externalAccountId, teamId),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(2);

  if (rows.length !== 1) {
    if (rows.length > 1) {
      console.error('[slack] ambiguous workspace identity; refusing to route inbound payload', {
        teamId,
      });
    }
    return null;
  }
  const row = rows[0]!;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    organizationId: row.organizationId,
    connectionId: row.id,
    botUserId: typeof metadata.botUserId === 'string' ? metadata.botUserId : null,
    // Slack slash payloads do not include the user's locale. Until durable
    // Slack→TaskNebula identity mapping exists, use the installer's supported
    // locale and fall back to the product default.
    locale: isSupportedLocale(row.locale) ? row.locale : defaultLocale,
  };
}

/**
 * Best-effort mapping from a Slack user id to a TaskNebula user id. Two
 * matching strategies, evaluated in order:
 *   1. exact lookup in users.slackUserId (if such a column exists today —
 *      otherwise this no-ops gracefully and we fall through),
 *   2. match on Slack profile email — left as a follow-up since we'd need
 *      another Slack API call to resolve the user's email.
 *
 * Returns null when no match is found.
 */
export async function lookupTaskNebulaUserBySlackId(
  organizationId: string,
  slackUserId: string,
  slackTeamId: string
): Promise<string | null> {
  const [connection] = await db
    .select({ accessTokenEnc: integrationConnections.accessTokenEnc })
    .from(integrationConnections)
    .innerJoin(organizations, eq(organizations.id, integrationConnections.organizationId))
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, 'slack'),
        eq(integrationConnections.externalAccountId, slackTeamId),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(1);
  if (!connection?.accessTokenEnc) return null;

  const profile = await callSlackApi<{
    user?: { deleted?: boolean; is_bot?: boolean; profile?: { email?: string } };
  }>('users.info', connection.accessTokenEnc, { user: slackUserId });
  const email = profile.ok ? profile.data?.user?.profile?.email?.trim().toLowerCase() : null;
  if (!email || profile.data?.user?.deleted || profile.data?.user?.is_bot) return null;

  const [member] = await db
    .select({ userId: users.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'active'),
        eq(users.status, 'active'),
        ilike(users.email, email),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(1);
  return member?.userId ?? null;
}

/**
 * Handle the parsed slash command and return a Slack-formatted response.
 *
 * Each verb gets its own helper; the top-level switch is just a dispatch
 * table so the file reads like a menu.
 */
export async function handleSlashCommand(
  parsed: ParsedSlashCommand,
  ctx: SlackCommandContext
): Promise<SlackSlashResponse> {
  const org = await resolveSlackOrg(ctx.teamId);
  const t = await getSlackTranslator(org?.locale ?? defaultLocale);
  if (!org) return ephemeral(t('notInstalled'));

  switch (parsed.verb) {
    case 'help':
      return ephemeral(t('help'));
    case 'list':
      return handleListMine(org.organizationId, ctx, t);
    case 'search':
      return handleSearch(org.organizationId, parsed.raw, ctx, t);
    case 'assign':
      return handleAssign(org.organizationId, parsed.args, ctx, t);
    case 'status':
      return handleStatus(org.organizationId, parsed.args, ctx, t);
    case 'new':
      return handleNew(org.organizationId, parsed.raw, ctx, t);
    case 'unknown':
    default:
      return ephemeral(`${t('unknownCommand')}\n${t('help')}`);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleListMine(
  organizationId: string,
  ctx: SlackCommandContext,
  t: SlackTranslator
): Promise<SlackSlashResponse> {
  const userId = await lookupTaskNebulaUserBySlackId(organizationId, ctx.slackUserId, ctx.teamId);
  if (!userId) {
    return ephemeral(t('userUnmapped'));
  }

  const rows = await db
    .select({
      key: issues.key,
      title: issues.title,
      projectId: issues.projectId,
      statusName: workflowStatuses.name,
      category: workflowStatuses.category,
    })
    .from(issues)
    .leftJoin(workflowStatuses, eq(issues.statusId, workflowStatuses.id))
    .where(and(eq(issues.organizationId, organizationId), eq(issues.assigneeId, userId)))
    .orderBy(desc(issues.updatedAt))
    .limit(15);

  const readable = await Promise.all(
    rows.map(async (row) => ({
      row,
      allowed: (await resolveProjectCapabilityAccess(userId, row.projectId)).canRead,
    }))
  );
  const open = readable
    .filter(({ row, allowed }) => allowed && row.category !== 'done')
    .map(({ row }) => row);
  if (open.length === 0) {
    return ephemeral(t('noOpenAssigned'));
  }

  const lines = open.map((r) => `• *${r.key}* — ${r.title} _(${r.statusName ?? t('noStatus')})_`);
  return ephemeral(`${t('openIssuesHeader')}\n${lines.join('\n')}`);
}

async function handleSearch(
  organizationId: string,
  query: string,
  ctx: SlackCommandContext,
  t: SlackTranslator
): Promise<SlackSlashResponse> {
  const userId = await lookupTaskNebulaUserBySlackId(organizationId, ctx.slackUserId, ctx.teamId);
  if (!userId) return ephemeral(t('userUnmapped'));

  const q = query.trim();
  if (!q) {
    return ephemeral(t('searchUsage'));
  }

  const like = `%${q}%`;
  const rows = await db
    .select({
      key: issues.key,
      title: issues.title,
      projectId: issues.projectId,
      statusName: workflowStatuses.name,
    })
    .from(issues)
    .leftJoin(workflowStatuses, eq(issues.statusId, workflowStatuses.id))
    .where(
      and(
        eq(issues.organizationId, organizationId),
        or(ilike(issues.title, like), ilike(issues.key, like))
      )
    )
    .orderBy(desc(issues.updatedAt))
    .limit(25);

  const accessRows = await Promise.all(
    rows.map(async (row) => ({
      row,
      allowed: (await resolveProjectCapabilityAccess(userId, row.projectId)).canRead,
    }))
  );
  const visibleRows = accessRows
    .filter(({ allowed }) => allowed)
    .map(({ row }) => row)
    .slice(0, 5);

  if (visibleRows.length === 0) {
    return ephemeral(t('searchNoMatches', { query: q }));
  }

  // Block Kit list — each result as a section so they wrap nicely in mobile.
  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${t('searchTopMatches', { count: visibleRows.length, query: q })}*`,
      },
    },
    { type: 'divider' },
    ...visibleRows.map((r) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${r.key}* — ${r.title}\n_${r.statusName ?? t('noStatus')}_`,
      },
    })),
  ];

  return ephemeral(t('searchSummary', { count: visibleRows.length, query: q }), blocks);
}

async function handleAssign(
  organizationId: string,
  args: string[],
  ctx: SlackCommandContext,
  t: SlackTranslator
): Promise<SlackSlashResponse> {
  const issueKey = args[0];
  const mention = args[1];
  if (!issueKey || !mention) {
    return ephemeral(t('assignUsage'));
  }

  const slackUserId = parseSlackUserMention(mention);
  if (!slackUserId) {
    return ephemeral(t('invalidUserMention', { mention }));
  }

  const issueRow = await loadIssueByKey(organizationId, issueKey);
  if (!issueRow) {
    return ephemeral(t('issueNotFound', { issueKey }));
  }

  const newAssigneeId = await lookupTaskNebulaUserBySlackId(
    organizationId,
    slackUserId,
    ctx.teamId
  );
  if (!newAssigneeId) {
    return ephemeral(t('assigneeUnmapped'));
  }

  const actorUserId = await lookupTaskNebulaUserBySlackId(
    organizationId,
    ctx.slackUserId,
    ctx.teamId
  );
  if (!actorUserId) return ephemeral(t('userUnmapped'));
  const access = await resolveProjectCapabilityAccess(actorUserId, issueRow.projectId);
  if (!access.canRead || !access.permissions.canAssignIssues) {
    return ephemeral(t('issueNotFound', { issueKey }));
  }

  await db
    .update(issues)
    .set({ assigneeId: newAssigneeId, updatedAt: new Date() })
    .where(eq(issues.id, issueRow.id));

  // Fire webhooks so subscribers see the assignment change.
  void triggerWebhooks({
    organizationId,
    projectId: issueRow.projectId,
    event: 'issue.assigned',
    payload: {
      issueId: issueRow.id,
      issueKey: issueRow.key,
      assigneeId: newAssigneeId,
      source: 'slack-slash',
    },
    actorUserId: null,
  });

  return {
    response_type: 'in_channel',
    text: t('assignmentSuccess', {
      issueKey: issueRow.key,
      slackUserId,
      requestedBy: ctx.slackUserId,
    }),
  };
}

async function handleStatus(
  organizationId: string,
  args: string[],
  ctx: SlackCommandContext,
  t: SlackTranslator
): Promise<SlackSlashResponse> {
  const issueKey = args[0];
  const requested = (args[1] ?? '').toLowerCase();
  if (!issueKey || !requested) {
    return ephemeral(t('statusUsage'));
  }

  const issueRow = await loadIssueByKey(organizationId, issueKey);
  if (!issueRow) {
    return ephemeral(t('issueNotFound', { issueKey }));
  }

  const actorUserId = await lookupTaskNebulaUserBySlackId(
    organizationId,
    ctx.slackUserId,
    ctx.teamId
  );
  if (!actorUserId) {
    return ephemeral(t('userUnmapped'));
  }

  // Slash commands only advertise canonical workflow categories. Free-text
  // names cannot be authorized safely without a mapped workflow target.
  const targetCategory = mapStatusKeyword(requested);
  if (!targetCategory) {
    return ephemeral(t('statusUnavailable'));
  }

  let match: { id: string; name: string };
  try {
    match = await db.transaction(async (tx) => {
      const targetStatusId = await resolveProjectWorkflowStatusByCategory(tx, {
        organizationId,
        projectId: issueRow.projectId,
        issueId: issueRow.id,
        category: targetCategory,
      });
      if (!targetStatusId) {
        throw new WorkflowTransitionError('workflow_transition_status_invalid');
      }
      const prepared = await prepareIssueStatusTransition(tx, {
        organizationId,
        projectId: issueRow.projectId,
        issueId: issueRow.id,
        toStatusId: targetStatusId,
        actorUserId,
        expectedFromStatusId: issueRow.statusId,
      });
      await applyPreparedIssueStatusTransition(tx, {
        prepared,
        actorUserId,
        reason: 'slack_slash',
      });
      const [status] = await tx
        .select({ id: workflowStatuses.id, name: workflowStatuses.name })
        .from(workflowStatuses)
        .where(eq(workflowStatuses.id, targetStatusId))
        .limit(1);
      if (!status) {
        throw new WorkflowTransitionError('workflow_transition_status_invalid');
      }
      return status;
    });
  } catch (error) {
    if (!isWorkflowTransitionError(error)) throw error;
    console.warn('[slack-commands] status transition rejected', {
      organizationId,
      issueId: issueRow.id,
      code: error.code,
    });
    return ephemeral(t('statusUnavailable'));
  }

  void triggerWebhooks({
    organizationId,
    projectId: issueRow.projectId,
    event: 'issue.status_changed',
    payload: {
      issueId: issueRow.id,
      issueKey: issueRow.key,
      statusId: match.id,
      statusName: match.name,
      source: 'slack-slash',
    },
    actorUserId: null,
  });

  return {
    response_type: 'in_channel',
    text: t('statusSuccess', {
      issueKey: issueRow.key,
      statusName: match.name,
      requestedBy: ctx.slackUserId,
    }),
  };
}

/**
 * `/tn new <title>` — for the synchronous response we just acknowledge that
 * the modal is opening. The route handler (which has the trigger_id needed
 * for views.open) actually opens the modal. We return ephemeral here so the
 * acknowledgement doesn't leak into the channel.
 */
function handleNew(
  organizationId: string,
  title: string,
  _ctx: SlackCommandContext,
  t: SlackTranslator
): SlackSlashResponse {
  void organizationId;
  const trimmed = title.trim();
  if (!trimmed) {
    return ephemeral(t('newUsage'));
  }
  // The route handler opens the modal directly via views.open using the
  // trigger_id. We respond with a short ack so the user sees something
  // immediately even if Slack rate-limits the modal.
  return ephemeral(t('newOpening', { title: trimmed }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadIssueByKey(organizationId: string, key: string) {
  const normalized = key.toUpperCase();
  const [row] = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
      key: issues.key,
      statusId: issues.statusId,
    })
    .from(issues)
    .where(and(eq(issues.organizationId, organizationId), eq(issues.key, normalized)))
    .limit(1);
  return row ?? null;
}

/**
 * Map a free-text status keyword (the second arg to `/tn status`) to a
 * `workflow_status_category` value when possible. Returns null when the
 * keyword is meant to match a status name directly.
 */
function mapStatusKeyword(
  word: string
): 'backlog' | 'in_progress' | 'in_review' | 'done' | 'blocked' | null {
  switch (word) {
    case 'todo':
    case 'backlog':
      return 'backlog';
    case 'in_progress':
    case 'in-progress':
    case 'progress':
    case 'doing':
      return 'in_progress';
    case 'in_review':
    case 'in-review':
    case 'review':
      return 'in_review';
    case 'done':
    case 'closed':
    case 'complete':
    case 'completed':
      return 'done';
    case 'blocked':
      return 'blocked';
    default:
      return null;
  }
}

/**
 * Used by route handlers to silence unused-import lint warnings for symbols
 * we only need to keep imported because they're side-effectful (e.g.
 * triggering schema evaluation). Tree-shakeable in prod.
 */
export const __slackCommandsTouchpoints = {
  createId,
  inArray,
  organizationMembers,
  users,
};
