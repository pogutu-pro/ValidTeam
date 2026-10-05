/**
 * POST /api/issues/[issueId]/dispatch-agent
 *
 * Linear Agent Protocol entry point. Body:
 *   { provider: 'claude' | 'codex' | 'cursor' | 'devin' | 'copilot' | 'openhands' | 'custom',
 *     prompt_override?: string }
 *
 * Flow:
 *   1. Auth + assign-permission check on the issue.
 *   2. Resolve either an organization webhook provider or the optional
 *      beta local CLI runner (`local://claude` / `local://codex` or env).
 *   3. Generate a per-session HMAC secret, insert an `agent_sessions` row
 *      (state=pending), and build an AgentSessionRequest envelope.
 *   4. For local runners, start the CLI process in the background and stream
 *      status/log snapshots back into `agent_sessions.payload.localRun`.
 *      For webhooks, sign the envelope with the provider HMAC and POST it.
 *
 * The endpoint is intentionally synchronous: dispatch is small and the caller
 * wants to know whether the handoff was accepted. Long-running work happens
 * either in the local child process or on the external provider side.
 *
 * NOTE: GitHub Copilot Coding Agent has its own dispatch surface
 * (`POST /repos/{owner}/{repo}/copilot/agents/{agent_id}/runs`). We leave a
 * TODO below sketching the call we'd make once that endpoint is exposed to
 * us; for now `provider: 'copilot'` falls through to the generic webhook
 * path and admins are expected to wire a self-hosted bridge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { agentProviders, agentSessions, and, db, eq, getIssueById } from '@validteam/db';
import { auth } from '@/auth';
import {
  AGENT_PROVIDERS,
  generateAgentSecret,
  generateDeliveryId,
  signAgentPayload,
  type AgentProviderKind,
  type AgentSessionRequest,
} from '@/lib/agents/sessions';
import {
  isLocalAgentEndpoint,
  resolveLocalAgentRunner,
  runLocalAgentSession,
} from '@/lib/agents/local-runner';
import {
  postAgentProviderEndpoint,
  validateAgentProviderEndpoint,
} from '@/lib/agents/provider-endpoint';
import { childLogger } from '@/lib/logger';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';
import { aiDisabledResponse, isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { isProductFeatureEnabled, PRODUCT_FEATURE_FLAGS } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

const DISPATCH_TIMEOUT_MS = 10_000;
const log = childLogger('api/issues/dispatch-agent');

const bodySchema = z.object({
  provider: z.enum(AGENT_PROVIDERS as readonly [AgentProviderKind, ...AgentProviderKind[]]),
  prompt_override: z.string().max(16000).optional(),
});

function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

async function userCanAssign(userId: string, projectId: string): Promise<boolean> {
  const access = await resolveProjectCapabilityAccess(userId, projectId);
  return access.canManage || access.permissions.canAssignIssues;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  if (!(await isAiFeatureEnabled())) return aiDisabledResponse();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { issueId } = await params;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const issue = await getIssueById(issueId);
  if (!issue) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  }

  if (
    !(await isProductFeatureEnabled(PRODUCT_FEATURE_FLAGS.AGENT_DISPATCH, issue.organizationId))
  ) {
    return aiDisabledResponse();
  }

  const allowed = await userCanAssign(session.user.id, issue.projectId);
  if (!allowed) {
    return NextResponse.json(
      { error: 'No permission to dispatch agents on this issue' },
      { status: 403 }
    );
  }

  // GitHub Copilot Coding Agent bridge — left as a TODO. The actual call would
  // look roughly like the snippet below using the org's GitHub OAuth token
  // from `integration_connections`. Until that bridge ships, `copilot` falls
  // through to the generic webhook flow and admins wire their own runner.
  //
  // TODO(copilot):
  //   const token = decryptGithubAccessToken(orgId);
  //   await fetch(`https://api.github.com/repos/${owner}/${repo}/copilot/agents/${agentId}/runs`, {
  //     method: 'POST',
  //     headers: {
  //       Accept: 'application/vnd.github+json',
  //       Authorization: `Bearer ${token}`,
  //       'X-GitHub-Api-Version': '2022-11-28',
  //     },
  //     body: JSON.stringify({ issue_url: issueUrl, prompt: promptOverride }),
  //   });

  const [provider] = await db
    .select()
    .from(agentProviders)
    .where(
      and(
        eq(agentProviders.workspaceId, issue.organizationId),
        eq(agentProviders.provider, parsed.provider)
      )
    )
    .limit(1);

  const localRunner =
    !provider || isLocalAgentEndpoint(provider.endpointUrl)
      ? resolveLocalAgentRunner(parsed.provider, provider?.endpointUrl, provider?.enabled ?? false)
      : null;

  if ((!provider || !provider.enabled) && !localRunner) {
    return NextResponse.json(
      {
        error: `Provider '${parsed.provider}' is not configured for this workspace`,
      },
      { status: 422 }
    );
  }

  let providerEndpoint: URL | null = null;
  if (!localRunner && provider?.enabled) {
    try {
      providerEndpoint = await validateAgentProviderEndpoint(provider.endpointUrl);
    } catch (error) {
      log.warn(
        { err: error, provider: parsed.provider, workspaceId: issue.organizationId },
        'blocked unsafe agent provider endpoint'
      );
      return NextResponse.json({ error: 'Provider endpoint is not allowed' }, { status: 422 });
    }
  }

  const sessionSecret = generateAgentSecret();

  const [created] = await db
    .insert(agentSessions)
    .values({
      issueId,
      provider: parsed.provider,
      state: 'pending',
      signedSecret: sessionSecret,
      payload: {
        dispatchedBy: session.user.id,
        promptOverride: parsed.prompt_override ?? null,
        dispatchMode: localRunner ? 'local_cli' : 'webhook',
      },
    })
    .returning();

  if (!created) {
    return NextResponse.json({ error: 'Failed to create agent session' }, { status: 500 });
  }

  const appBaseUrl = getAppBaseUrl();
  const callbackUrl = `${appBaseUrl}/api/webhooks/agent-session/${parsed.provider}`;

  const envelope: AgentSessionRequest = {
    sessionId: created.id,
    issue: {
      id: issue.id,
      key: issue.key,
      title: issue.title,
      description: issue.description ?? null,
      priority: issue.priority,
      labels: issue.labels ?? [],
      projectId: issue.projectId,
      organizationId: issue.organizationId,
      url: `${appBaseUrl}/issues/${issue.id}`,
    },
    actorUserId: session.user.id,
    promptOverride: parsed.prompt_override ?? null,
    callbackUrl,
    dispatchedAt: new Date().toISOString(),
  };

  if (localRunner) {
    void runLocalAgentSession(localRunner, {
      sessionId: created.id,
      provider: localRunner.provider,
      issue: {
        ...envelope.issue,
        reporterId: issue.reporterId,
      },
      actorUserId: session.user.id,
      promptOverride: parsed.prompt_override ?? null,
      appBaseUrl,
    }).catch((err) => {
      console.error('[agent-dispatch] local runner failed to start', {
        sessionId: created.id,
        provider: parsed.provider,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({
      sessionId: created.id,
      provider: parsed.provider,
      state: 'active',
      runner: 'local_cli',
      callbackUrl,
    });
  }

  if (!provider || !provider.enabled) {
    return NextResponse.json(
      {
        error: `Provider '${parsed.provider}' is not configured for this workspace`,
      },
      { status: 422 }
    );
  }

  if (!providerEndpoint) {
    return NextResponse.json({ error: 'Provider endpoint is not allowed' }, { status: 422 });
  }

  const body = JSON.stringify(envelope);
  const signature = signAgentPayload(body, provider.hmacSecret);
  const deliveryId = generateDeliveryId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

  let status: 'success' | 'failed' = 'failed';
  let statusCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const resp = await postAgentProviderEndpoint(providerEndpoint.toString(), {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-ValidTeam-Event': 'agent.session.dispatch',
        'X-ValidTeam-Signature': `sha256=${signature}`,
        'X-ValidTeam-Delivery': deliveryId,
        'X-ValidTeam-Session-Id': created.id,
      },
      body,
    });
    statusCode = resp.status;
    status = resp.ok ? 'success' : 'failed';
    if (!resp.ok) errorMessage = `HTTP ${resp.status}`;
  } catch (err) {
    errorMessage =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Dispatch timed out after ${DISPATCH_TIMEOUT_MS}ms`
          : err.message
        : String(err);
  } finally {
    clearTimeout(timer);
  }

  // Mirror the outcome on the session row. We mark the row `active` on
  // success so the UI shows progress immediately; the provider's first event
  // will overwrite this anyway.
  await db
    .update(agentSessions)
    .set({
      state: status === 'success' ? 'active' : 'error',
      updatedAt: new Date(),
      finishedAt: status === 'success' ? null : new Date(),
      payload: {
        ...(typeof created.payload === 'object' && created.payload !== null
          ? (created.payload as Record<string, unknown>)
          : {}),
        dispatch: {
          deliveryId,
          status,
          statusCode,
          errorMessage,
          endpointUrl: providerEndpoint.toString(),
        },
      },
    })
    .where(eq(agentSessions.id, created.id));

  if (status !== 'success') {
    return NextResponse.json(
      {
        sessionId: created.id,
        provider: parsed.provider,
        status,
        statusCode,
        error: errorMessage,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    sessionId: created.id,
    provider: parsed.provider,
    state: 'active',
    callbackUrl,
  });
}
