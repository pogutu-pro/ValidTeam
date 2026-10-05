/**
 * Slack ↔ Issue bridge.
 *
 * Two responsibilities:
 *   1. createIssueFromSlackMessage — given an authenticated Slack workspace
 *      and a message payload, create a ValidTeam issue and stash a row in
 *      `slack_message_links` so subsequent updates mirror back into the same
 *      thread. The issue description embeds the Slack message text + author +
 *      a permalink, so context never gets lost.
 *   2. postMirroredThreadReply — used by other modules (issue comment route,
 *      status-change webhook handler) to mirror events back into the Slack
 *      thread that spawned the issue.
 *
 * Both helpers are safe to call without a connected integration — they log
 * and return when no Slack workspace owns the issue, so callers don't need
 * an `if (slack)` gate.
 */

import { createId } from '@paralleldrive/cuid2';
import {
  db,
  and,
  eq,
  desc,
  issues,
  organizations,
  projects,
  workflows,
  workflowStatuses,
  integrationConnections,
  auditLogs,
  issueActivities,
  slackChannelRoutes,
  slackMessageLinks,
  users,
} from '@validteam/db';
import { ne, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { callSlackApi, postSlackMessage } from './slack';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import { syncIssueLabelsWithExecutor } from '@/lib/labels/sync';
import { publishEventAwaitingFanOut } from '@/lib/realtime/events';
import { dispatchAuditLogToSinks } from '@/lib/audit/sink-dispatcher';
import { runAutomations } from '@/lib/automation/evaluator';
import { triggerWebhooks } from '@/lib/webhooks/dispatcher';
import { runTriageOnce } from '@/lib/agents/triage-enqueue';
import { defaultLocale, isSupportedLocale } from '@/lib/i18n/config';
import { buildAppUrl } from '@/lib/url/app-url';

export interface CreateFromSlackParams {
  organizationId: string;
  /** Slack workspace id (T...). */
  slackTeamId: string;
  /** Slack channel id (C...). */
  slackChannelId: string;
  /** Slack message timestamp (the natural key for that message). */
  slackMessageTs: string;
  /** Optional override — when set we open the thread under this ts instead. */
  slackThreadTs?: string | null;
  /** Slack user id of the message author — embedded into the description. */
  slackAuthorId: string;
  /** Permalink to the originating Slack message (chat.getPermalink). */
  permalink?: string | null;
  /** Free-text title for the issue. */
  title: string;
  /** Optional long-form description. The Slack quote is appended automatically. */
  description?: string | null;
  /** Project the issue should belong to. When null, the channel route is consulted. */
  projectId?: string | null;
  /** Slack message text (quoted in the description). */
  messageText?: string | null;
  /** Slack channel name for the description (best-effort). */
  channelName?: string | null;
  /** ValidTeam user id that performed the action — used for createdBy/reporter. */
  reporterUserId: string;
  /** Extra labels to apply (e.g. "slack"). The channel route's label is added automatically. */
  extraLabels?: string[];
  /** Attach non-critical fan-out to a route handler's `after()` lifecycle. */
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
}

export interface CreatedIssue {
  id: string;
  key: string;
  projectId: string;
  organizationId: string;
}

export interface SlackBridgeResult {
  issue: CreatedIssue;
  /** Slack ts of the bot's confirmation reply, when the post succeeded. */
  threadTs: string | null;
}

/**
 * Create a new ValidTeam issue from a Slack message, post a confirmation
 * reply into the message's thread, and persist the bidirectional mapping.
 *
 * Returns `null` when the project cannot be resolved (no projectId arg, no
 * channel route, and no fallback) — the caller should surface the error to
 * the Slack user via the modal response or the slash command response.
 */
export async function createIssueFromSlackMessage(
  params: CreateFromSlackParams
): Promise<SlackBridgeResult | null> {
  const projectId = await resolveProjectId(
    params.organizationId,
    params.slackTeamId,
    params.slackChannelId,
    params.projectId ?? null
  );
  if (!projectId) return null;

  const project = await loadProject(projectId, params.organizationId);
  if (!project) return null;

  const reporterAccess = await resolveProjectCapabilityAccess(params.reporterUserId, projectId);
  if (
    !reporterAccess.canRead ||
    reporterAccess.project?.organizationId !== params.organizationId ||
    !reporterAccess.permissions.canCreateIssues
  ) {
    return null;
  }
  const t = await getSlackBridgeTranslator(params.reporterUserId);

  // Pick the project's default workflow + first backlog status.
  const workflowId = await resolveWorkflowId(project.organizationId, project.defaultWorkflowId);
  if (!workflowId) return null;

  const [backlogStatus] = await db
    .select()
    .from(workflowStatuses)
    .where(
      and(eq(workflowStatuses.workflowId, workflowId), eq(workflowStatuses.category, 'backlog'))
    )
    .limit(1);
  if (!backlogStatus) return null;

  // Compose description: caller-supplied body first, then a "From Slack"
  // block with the original message text + permalink + author.
  const quotedBlock = buildSlackQuoteBlock({
    text: params.messageText ?? '',
    permalink: params.permalink ?? null,
    authorSlackId: params.slackAuthorId,
    channelName: params.channelName ?? null,
    t,
  });
  const fullDescription = [params.description?.trim() || '', quotedBlock]
    .filter(Boolean)
    .join('\n\n');

  // Labels: caller extras + channel route default + a "slack" tag we always add.
  const routeDefaults = await loadRouteDefaults(
    params.organizationId,
    params.slackTeamId,
    params.slackChannelId
  );
  const labels = Array.from(
    new Set([
      ...(params.extraLabels ?? []),
      ...(routeDefaults.label ? [routeDefaults.label] : []),
      'slack',
    ])
  );

  const persisted = await db.transaction(async (tx) => {
    // Slack retries events and interactive submissions. Serialize both the
    // provider message identity and project number allocation so one message
    // creates at most one issue and concurrent creates never share a number.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`slack-message:${params.slackTeamId}:${params.slackChannelId}:${params.slackMessageTs}`}))`
    );
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`issue-number:${projectId}`}))`);

    const [existing] = await tx
      .select({
        issueId: issues.id,
        issueKey: issues.key,
        projectId: issues.projectId,
        organizationId: issues.organizationId,
        threadTs: slackMessageLinks.slackThreadTs,
      })
      .from(slackMessageLinks)
      .innerJoin(issues, eq(issues.id, slackMessageLinks.issueId))
      .where(
        and(
          eq(slackMessageLinks.organizationId, params.organizationId),
          eq(slackMessageLinks.slackTeamId, params.slackTeamId),
          eq(slackMessageLinks.slackChannelId, params.slackChannelId),
          eq(slackMessageLinks.slackMessageTs, params.slackMessageTs)
        )
      )
      .limit(1);
    if (existing) {
      return {
        created: false as const,
        issue: {
          id: existing.issueId,
          key: existing.issueKey,
          projectId: existing.projectId,
          organizationId: existing.organizationId,
        },
        threadTs: existing.threadTs,
        payload: null,
        auditEvent: null,
      };
    }

    const [last] = await tx
      .select({ number: issues.number })
      .from(issues)
      .where(eq(issues.projectId, projectId))
      .orderBy(desc(issues.number))
      .limit(1);
    const nextNumber = (last?.number ?? 0) + 1;
    const issueKey = `${project.key}-${nextNumber}`;
    const issueId = createId();
    const now = new Date();

    const issuePayload = {
      id: issueId,
      organizationId: project.organizationId,
      projectId,
      key: issueKey,
      number: nextNumber,
      type: 'task' as const,
      title:
        params.title.trim().slice(0, 500) ||
        t('bridgeFallbackTitle', {
          message: (params.messageText ?? '').trim().slice(0, 80) || t('untitledSlackMessage'),
        }),
      description: fullDescription || null,
      statusId: backlogStatus.id,
      priority: routeDefaults.priority,
      reporterId: params.reporterUserId,
      labels,
      customFields: {},
      metadata: {
        source: 'slack',
        slackTeamId: params.slackTeamId,
        slackChannelId: params.slackChannelId,
        slackMessageTs: params.slackMessageTs,
        slackPermalink: params.permalink ?? null,
      },
      createdBy: params.reporterUserId,
      updatedBy: params.reporterUserId,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(issues).values(issuePayload);

    await syncIssueLabelsWithExecutor(
      {
        organizationId: project.organizationId,
        issueId,
        labels,
        createdBy: params.reporterUserId,
      },
      tx
    );

    await tx.insert(issueActivities).values({
      id: createId(),
      issueId,
      userId: params.reporterUserId,
      type: 'created',
      metadata: { source: 'slack' },
      createdBy: params.reporterUserId,
      updatedBy: params.reporterUserId,
    });

    const auditId = createId();
    const auditMetadata = {
      source: 'slack',
      issueKey,
      title: issuePayload.title,
      slackTeamId: params.slackTeamId,
      slackChannelId: params.slackChannelId,
      slackMessageTs: params.slackMessageTs,
    };
    await tx.insert(auditLogs).values({
      id: auditId,
      userId: params.reporterUserId,
      organizationId: project.organizationId,
      action: 'issue.created',
      resourceType: 'issue',
      resourceId: issueId,
      projectId,
      issueId,
      metadata: auditMetadata,
      createdAt: now,
    });
    const initialThreadTs = params.slackThreadTs ?? params.slackMessageTs;
    await tx.insert(slackMessageLinks).values({
      organizationId: params.organizationId,
      slackTeamId: params.slackTeamId,
      slackChannelId: params.slackChannelId,
      slackMessageTs: params.slackMessageTs,
      slackThreadTs: initialThreadTs,
      issueId,
      permalink: params.permalink ?? null,
    });

    return {
      created: true as const,
      issue: { id: issueId, key: issueKey, projectId, organizationId: project.organizationId },
      threadTs: initialThreadTs,
      payload: issuePayload,
      auditEvent: {
        id: auditId,
        metadata: auditMetadata,
        createdAt: now.toISOString(),
      },
    };
  });

  if (!persisted.created) {
    return { issue: persisted.issue, threadTs: persisted.threadTs };
  }

  // The core issue, first-class labels, activity, Slack link, and audit row
  // are durable at this point. Keep derived work attached to the request
  // lifecycle when a route supplies Next's `after()` scheduler.
  const completePostCommitWork = async (): Promise<string | null> => {
    const sideEffects = await Promise.allSettled([
      publishEventAwaitingFanOut('issue.created', params.reporterUserId, {
        projectId: persisted.issue.projectId,
        issueId: persisted.issue.id,
        organizationId: persisted.issue.organizationId,
      }),
      runTriageOnce(persisted.issue.id),
      dispatchAuditLogToSinks({
        id: persisted.auditEvent.id,
        workspaceId: persisted.issue.organizationId,
        action: 'issue.created',
        resourceType: 'issue',
        resourceId: persisted.issue.id,
        userId: params.reporterUserId,
        projectId: persisted.issue.projectId,
        issueId: persisted.issue.id,
        metadata: persisted.auditEvent.metadata,
        changes: null,
        createdAt: persisted.auditEvent.createdAt,
      }),
      runAutomations({
        trigger: 'issue.created',
        organizationId: persisted.issue.organizationId,
        projectId: persisted.issue.projectId,
        payload: persisted.payload,
        actorUserId: params.reporterUserId,
      }),
      triggerWebhooks({
        event: 'issue.created',
        organizationId: persisted.issue.organizationId,
        projectId: persisted.issue.projectId,
        payload: persisted.payload,
        actorUserId: params.reporterUserId,
      }),
    ]);
    for (const result of sideEffects) {
      if (result.status === 'rejected') {
        console.error('[slack-bridge] post-commit side effect failed', result.reason);
      }
    }

    if (!params.slackChannelId) return persisted.threadTs;
    try {
      const issueUrl = buildAppUrl(`/issues/${persisted.issue.id}`);
      const postedThreadTs = await postConfirmationReply({
        organizationId: params.organizationId,
        channel: params.slackChannelId,
        threadTs: params.slackThreadTs ?? params.slackMessageTs,
        slackTeamId: params.slackTeamId,
        confirmationText: t('bridgeConfirmationText', {
          issueKey: persisted.issue.key,
          issueUrl,
        }),
        confirmationBlock: t('bridgeConfirmationBlock', {
          issueKey: persisted.issue.key,
          issueUrl,
        }),
      });
      if (!postedThreadTs) return persisted.threadTs;
      await db
        .update(slackMessageLinks)
        .set({ slackThreadTs: postedThreadTs })
        .where(
          and(
            eq(slackMessageLinks.organizationId, params.organizationId),
            eq(slackMessageLinks.issueId, persisted.issue.id)
          )
        );
      return postedThreadTs;
    } catch (err) {
      console.warn('[slack-bridge] confirmation reply failed', err);
      return persisted.threadTs;
    }
  };

  if (params.scheduleAfterResponse) {
    params.scheduleAfterResponse(async () => {
      await completePostCommitWork();
    });
    return { issue: persisted.issue, threadTs: persisted.threadTs };
  }

  const threadTs = await completePostCommitWork();

  return {
    issue: persisted.issue,
    threadTs,
  };
}

// ---------------------------------------------------------------------------
// Mirror-back helpers
// ---------------------------------------------------------------------------

/**
 * Mirror a ValidTeam event (comment, status change) back into the Slack
 * thread that originally produced the issue. Returns true when a thread
 * reply was posted (or no link exists — silent no-op), false on failure.
 */
export async function postMirroredThreadReply(params: {
  issueId: string;
  text: string;
}): Promise<boolean> {
  const [link] = await db
    .select({
      organizationId: slackMessageLinks.organizationId,
      slackTeamId: slackMessageLinks.slackTeamId,
      slackChannelId: slackMessageLinks.slackChannelId,
      slackThreadTs: slackMessageLinks.slackThreadTs,
      slackMessageTs: slackMessageLinks.slackMessageTs,
    })
    .from(slackMessageLinks)
    .where(eq(slackMessageLinks.issueId, params.issueId))
    .limit(1);
  if (!link) return true; // Not a Slack-spawned issue; silently succeed.

  const [conn] = await db
    .select({ accessTokenEnc: integrationConnections.accessTokenEnc })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, link.organizationId),
        eq(integrationConnections.provider, 'slack'),
        eq(integrationConnections.externalAccountId, link.slackTeamId)
      )
    )
    .limit(1);
  if (!conn) return false;

  const result = await postSlackMessage(conn.accessTokenEnc, {
    channel: link.slackChannelId,
    text: params.text,
    threadTs: link.slackThreadTs ?? link.slackMessageTs,
  });
  return result.ok;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadProject(projectId: string, organizationId: string) {
  const [row] = await db
    .select({
      id: projects.id,
      key: projects.key,
      organizationId: projects.organizationId,
      defaultWorkflowId: projects.defaultWorkflowId,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        eq(projects.status, 'active'),
        ne(organizations.status, 'suspended')
      )
    )
    .limit(1);
  return row ?? null;
}

async function resolveWorkflowId(
  organizationId: string,
  projectDefault: string | null
): Promise<string | null> {
  if (projectDefault) return projectDefault;
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.organizationId, organizationId), eq(workflows.isDefault, true)))
    .limit(1);
  return wf?.id ?? null;
}

/**
 * Resolve which project a Slack-originating issue should land in. Caller
 * preference wins; otherwise we consult the per-channel mapping. Returns
 * null when nothing is configured so the caller can surface a helpful
 * error rather than silently picking a project.
 */
async function resolveProjectId(
  organizationId: string,
  slackTeamId: string,
  slackChannelId: string,
  caller: string | null
): Promise<string | null> {
  if (caller) return caller;
  const [route] = await db
    .select({ projectId: slackChannelRoutes.projectId })
    .from(slackChannelRoutes)
    .where(
      and(
        eq(slackChannelRoutes.organizationId, organizationId),
        eq(slackChannelRoutes.slackTeamId, slackTeamId),
        eq(slackChannelRoutes.slackChannelId, slackChannelId)
      )
    )
    .limit(1);
  return route?.projectId ?? null;
}

async function loadRouteDefaults(
  organizationId: string,
  slackTeamId: string,
  slackChannelId: string
): Promise<{
  label: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'none';
}> {
  const [route] = await db
    .select({
      defaultLabel: slackChannelRoutes.defaultLabel,
      defaultPriority: slackChannelRoutes.defaultPriority,
    })
    .from(slackChannelRoutes)
    .where(
      and(
        eq(slackChannelRoutes.organizationId, organizationId),
        eq(slackChannelRoutes.slackTeamId, slackTeamId),
        eq(slackChannelRoutes.slackChannelId, slackChannelId)
      )
    )
    .limit(1);
  const priority = ['critical', 'high', 'medium', 'low', 'none'].includes(
    route?.defaultPriority ?? ''
  )
    ? (route!.defaultPriority as 'critical' | 'high' | 'medium' | 'low' | 'none')
    : 'medium';
  return { label: route?.defaultLabel ?? null, priority };
}

function buildSlackQuoteBlock(params: {
  text: string;
  permalink: string | null;
  authorSlackId: string;
  channelName: string | null;
  t: Awaited<ReturnType<typeof getSlackBridgeTranslator>>;
}): string {
  const lines: string[] = ['---', `*${params.t('bridgeFromSlack')}*`];
  if (params.permalink) {
    lines.push(params.t('bridgePermalink', { url: params.permalink }));
  }
  lines.push(
    params.channelName
      ? params.t('bridgeAuthorInChannel', {
          author: params.authorSlackId,
          channel: params.channelName,
        })
      : params.t('bridgeAuthor', { author: params.authorSlackId })
  );
  const quote = params.text.trim()
    ? params.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    : `> ${params.t('bridgeEmptyMessage')}`;
  lines.push(quote);
  return lines.join('\n');
}

/**
 * Post the bot's "issue created" message into the originating thread and
 * return the new message's ts (used as `slack_thread_ts` for future mirrors).
 */
async function postConfirmationReply(params: {
  organizationId: string;
  channel: string;
  threadTs: string;
  slackTeamId: string;
  confirmationText: string;
  confirmationBlock: string;
}): Promise<string | null> {
  const [conn] = await db
    .select({ accessTokenEnc: integrationConnections.accessTokenEnc })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, params.organizationId),
        eq(integrationConnections.provider, 'slack'),
        eq(integrationConnections.externalAccountId, params.slackTeamId)
      )
    )
    .limit(1);
  if (!conn) return null;

  const result = await callSlackApi<{ ts: string }>('chat.postMessage', conn.accessTokenEnc, {
    channel: params.channel,
    thread_ts: params.threadTs,
    text: params.confirmationText,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: params.confirmationBlock,
        },
      },
    ],
  });

  if (!result.ok || !result.data?.ts) return null;
  return result.data.ts;
}

async function getSlackBridgeTranslator(userId: string) {
  const [user] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const locale = isSupportedLocale(user?.locale) ? user.locale : defaultLocale;
  return getTranslations({ locale, namespace: 'slackCommands' });
}

/** Touchpoint exports to keep tree-shakers happy with unused imports. */
export const __slackBridgeTouchpoints = {
  sql,
};
