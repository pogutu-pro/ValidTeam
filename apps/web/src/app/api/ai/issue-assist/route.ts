import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { createAuditLog, db, issueComments, organizations, users } from '@tasknebula/db';
import { auth } from '@/auth';
import { aiDisabledResponse, isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { AiDraftError, type DraftProvider } from '@/lib/ai/draft-issue';
import {
  ISSUE_ASSIST_ACTIONS,
  runIssueAssist,
  type IssueAssistAction,
} from '@/lib/ai/issue-assist';
import { BudgetExhaustedError } from '@/lib/ai/budget';
import { getSystemAgentControlSettingsFromDb } from '@/lib/agents/system';
import { resolveProviderApiKeyFromSettings } from '@/lib/agents/credentials';
import { normalizeWorkspaceAgentSettings } from '@/lib/agents/config';
import { evaluateInjectionRisk } from '@/lib/ai/safety/sandbox';
import { canReadIssue } from '@/lib/auth/access-control';
import { isProductFeatureEnabled, PRODUCT_FEATURE_FLAGS } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  issueId: z.string().min(1),
  action: z.enum(ISSUE_ASSIST_ACTIONS),
  customPrompt: z.string().max(2000).nullable().optional(),
  provider: z.enum(['native', 'openai', 'anthropic']).optional(),
});

async function resolveProviderAndKey(
  requested: DraftProvider | undefined,
  organizationId: string
): Promise<{ provider: DraftProvider; apiKey: string | null }> {
  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const orgSettings = (org?.settings as Record<string, unknown> | null) || null;
  const system = await getSystemAgentControlSettingsFromDb();
  const platformStore = system.providerCredentials ?? null;
  const workspace = normalizeWorkspaceAgentSettings(
    (orgSettings as { aiAgents?: unknown })?.aiAgents
  );
  const workspaceDefault: DraftProvider =
    workspace.provider === 'anthropic' || workspace.provider === 'openai'
      ? workspace.provider
      : 'native';
  const tryProvider = (p: DraftProvider): string | null => {
    if (p === 'native') return null;
    return resolveProviderApiKeyFromSettings(orgSettings, p, platformStore);
  };
  if (requested === 'native') return { provider: 'native', apiKey: null };
  if (requested === 'openai' || requested === 'anthropic') {
    const key = tryProvider(requested);
    if (key) return { provider: requested, apiKey: key };
  }
  if (workspaceDefault !== 'native') {
    const key = tryProvider(workspaceDefault);
    if (key) return { provider: workspaceDefault, apiKey: key };
  }
  const a = tryProvider('anthropic');
  if (a) return { provider: 'anthropic', apiKey: a };
  const o = tryProvider('openai');
  if (o) return { provider: 'openai', apiKey: o };
  return { provider: 'native', apiKey: null };
}

export async function POST(request: NextRequest) {
  if (!(await isAiFeatureEnabled())) return aiDisabledResponse();

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const issueAccess = await canReadIssue(session.user.id, body.issueId);
  const issue = issueAccess.issue;
  if (!issue) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  }
  if (!issueAccess.allowed) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (
    !(await isProductFeatureEnabled(PRODUCT_FEATURE_FLAGS.AI_ISSUE_ASSIST, issue.organizationId))
  ) {
    return aiDisabledResponse();
  }

  const [org] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, issue.organizationId))
    .limit(1);
  const workspace = normalizeWorkspaceAgentSettings(
    ((org?.settings as { aiAgents?: unknown } | null) ?? {}).aiAgents
  );
  if (!workspace.assistantEnabled) {
    return NextResponse.json(
      {
        error:
          'AI Assistant is disabled for this workspace. Enable it in Settings → AI & Agents → Quick setup.',
        code: 'assistant_disabled',
      },
      { status: 412 }
    );
  }

  // Recent comments for summarize context.
  const recent = await db
    .select({
      content: issueComments.content,
      createdAt: issueComments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(issueComments)
    .leftJoin(users, eq(users.id, issueComments.createdBy))
    .where(eq(issueComments.issueId, issue.id))
    .orderBy(desc(issueComments.createdAt))
    .limit(8);

  const { provider, apiKey } = await resolveProviderAndKey(body.provider, issue.organizationId);
  const modelToUse = workspace.model?.trim() || null;

  // Prompt-injection safety: untrusted text fed to the LLM here is the issue description +
  // comment bodies + customPrompt. Score the combined blob so a comment
  // that says "system: ignore previous instructions" trips the same guard
  // a malicious draft prompt would.
  const combined = [
    issue.description ?? '',
    body.customPrompt ?? '',
    ...recent.map((c) => c.content ?? ''),
  ]
    .filter(Boolean)
    .join('\n---\n');
  const safetyMode = workspace.aiSafetyMode ?? 'warn';
  const verdict = await evaluateInjectionRisk(combined, {
    mode: safetyMode,
    anthropicApiKey: provider === 'anthropic' ? apiKey : null,
  });
  if (verdict.flagged) {
    await createAuditLog({
      userId: session.user.id,
      organizationId: issue.organizationId,
      action: 'agent.run_failed',
      resourceType: 'issue',
      resourceId: issue.id,
      projectId: issue.projectId,
      issueId: issue.id,
      metadata: {
        kind: 'issue_assist',
        subAction: body.action,
        reason: 'injection_suspected',
        score: verdict.score,
        mode: safetyMode,
      },
    }).catch(() => {});
  }
  if (verdict.refuse) {
    return NextResponse.json(
      {
        error:
          'The issue contents look like they include instructions targeted at the AI. Workspace safety mode is "strict", so this request was blocked.',
        code: 'prompt_injection_suspected',
        score: verdict.score,
      },
      { status: 422 }
    );
  }

  try {
    const result = await runIssueAssist({
      action: body.action as IssueAssistAction,
      provider,
      apiKey,
      model: modelToUse,
      issue: {
        key: issue.key,
        type: issue.type,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        labels: (issue.labels as string[] | null) ?? [],
      },
      recentComments: recent.map((c) => ({
        author: c.authorName || c.authorEmail || 'unknown',
        body: c.content,
        at: new Date(c.createdAt).toISOString(),
      })),
      customPrompt: body.customPrompt ?? null,
      budgetContext: {
        organizationId: issue.organizationId,
        userId: session.user.id,
        feature: `assist:${body.action}`,
      },
    });

    await createAuditLog({
      userId: session.user.id,
      organizationId: issue.organizationId,
      action: 'agent.run_completed',
      resourceType: 'issue',
      resourceId: issue.id,
      projectId: issue.projectId,
      issueId: issue.id,
      metadata: {
        kind: 'issue_assist',
        subAction: body.action,
        provider,
      },
    }).catch(() => {});

    return NextResponse.json({ ...result, provider });
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      return NextResponse.json(
        { error: err.message, code: 'budget_exhausted', reason: err.code },
        { status: 429 }
      );
    }
    if (err instanceof AiDraftError) {
      await createAuditLog({
        userId: session.user.id,
        organizationId: issue.organizationId,
        action: 'agent.run_failed',
        resourceType: 'issue',
        resourceId: issue.id,
        projectId: issue.projectId,
        issueId: issue.id,
        metadata: {
          kind: 'issue_assist',
          subAction: body.action,
          provider,
          errorCode: err.code,
        },
      }).catch(() => {});
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'missing_credential' ? 412 : 502 }
      );
    }
    console.error('[issue-assist] unexpected error', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
