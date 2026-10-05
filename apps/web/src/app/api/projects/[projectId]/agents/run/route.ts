import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { db, eq, organizations, projects } from '@validteam/db';
import { getProjectAgentAccess } from '@/lib/agents/access';
import {
  AGENT_RUN_KINDS,
  getAgentProviderReadiness,
  getProjectAgentRunAvailability,
  normalizeProjectAgentSettings,
  normalizeWorkspaceAgentSettings,
  resolveEffectiveProjectAgentSettings,
} from '@/lib/agents/config';
import { getProviderCredentialStatusFromSettings } from '@/lib/agents/credentials';
import { applyWorkspaceModelConfig } from '@/lib/agents/model-configs';
import {
  ProjectAgentAdmissionError,
  ProjectAgentIdempotencyConflict,
  enqueueProjectAgentRun,
  processProjectAgentRunQueue,
} from '@/lib/agents/engine';
import {
  findDurableProjectAgentRunReplay,
  serializeProjectAgentRunEnvelope,
} from '@/lib/agents/project-agent-run-store';
import { getSystemAgentControlSettingsFromDb } from '@/lib/agents/system';
import { aiDisabledResponse, isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { childLogger } from '@/lib/logger';

const log = childLogger('api/projects/agents/run');

const runAgentSchema = z.object({
  kind: z.enum(AGENT_RUN_KINDS),
  dryRun: z.boolean().optional().default(false),
});

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

function responseStatusForRun(run: { status: string; output: unknown }) {
  if (run.status === 'completed') return 200;
  if (run.status === 'failed') {
    const output = (run.output ?? {}) as Record<string, unknown>;
    return typeof output.httpStatus === 'number' ? output.httpStatus : 500;
  }
  return 202;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId } = await params;
  const access = await getProjectAgentAccess(session.user.id, projectId);
  if (!access.canManage || !access.project) {
    return NextResponse.json(
      { error: 'You do not have permission to run project agents.' },
      { status: 403 }
    );
  }

  const rawIdempotencyKey = request.headers.get('idempotency-key');
  if (!rawIdempotencyKey) {
    return NextResponse.json({ error: 'Idempotency-Key header is required' }, { status: 428 });
  }
  const parsedIdempotencyKey = idempotencyKeySchema.safeParse(rawIdempotencyKey);
  if (!parsedIdempotencyKey.success) {
    return NextResponse.json({ error: 'Invalid Idempotency-Key header' }, { status: 400 });
  }
  const idempotencyKey = parsedIdempotencyKey.data;

  try {
    const body = await request.json();
    const { kind, dryRun } = runAgentSchema.parse(body);

    // Replays are resolved before current provider/policy gates. Admin config
    // drift must not turn an already accepted request into a different result.
    const replay = await findDurableProjectAgentRunReplay({
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      initiatedBy: session.user.id,
      idempotencyKey,
      kind,
      requestedDryRun: dryRun,
    });
    if (replay) {
      const envelope = serializeProjectAgentRunEnvelope(replay);
      const replayOutput = envelope.output ?? {};
      const errorCode =
        typeof replayOutput.errorCode === 'string' ? replayOutput.errorCode : 'agent_run_failed';
      return NextResponse.json(replay.status === 'failed' ? { ...envelope, errorCode } : envelope, {
        status: responseStatusForRun(replay),
      });
    }

    if (!(await isAiFeatureEnabled())) return aiDisabledResponse();

    const [[project], [organization], systemControl] = await Promise.all([
      db
        .select({
          id: projects.id,
          settings: projects.settings,
          organizationId: projects.organizationId,
        })
        .from(projects)
        .where(eq(projects.id, access.project.id))
        .limit(1),
      db
        .select({
          id: organizations.id,
          settings: organizations.settings,
        })
        .from(organizations)
        .where(eq(organizations.id, access.project.organizationId))
        .limit(1),
      getSystemAgentControlSettingsFromDb(),
    ]);

    if (!project || !organization) {
      return NextResponse.json({ error: 'Project context could not be loaded' }, { status: 404 });
    }

    const rawWorkspaceSettings = normalizeWorkspaceAgentSettings(
      (organization.settings as Record<string, unknown> | null)?.aiAgents
    );
    const { workspaceSettings, selectedModelConfig } = await applyWorkspaceModelConfig({
      organizationId: organization.id,
      workspaceSettings: rawWorkspaceSettings,
    });
    const projectSettings = normalizeProjectAgentSettings(
      (project.settings as Record<string, unknown> | null)?.aiAgents
    );
    const effectiveSettings = resolveEffectiveProjectAgentSettings(
      workspaceSettings,
      projectSettings,
      systemControl
    );
    const providerStatus = getAgentProviderReadiness(
      effectiveSettings.provider,
      effectiveSettings.model,
      getProviderCredentialStatusFromSettings(
        organization.settings as Record<string, unknown> | null,
        effectiveSettings.provider
      )
    );
    const runAvailability = getProjectAgentRunAvailability({
      workspaceSettings,
      projectSettings,
      effectiveSettings,
      providerStatus,
      systemControl,
    });

    if (!systemControl.globalEnabled) {
      return NextResponse.json(
        { error: 'Agents are paused globally by the admin team.' },
        { status: 409 }
      );
    }

    if (!workspaceSettings.enabled) {
      return NextResponse.json({ error: 'Workspace AI agents are disabled.' }, { status: 409 });
    }

    if (!projectSettings.enabled) {
      return NextResponse.json(
        { error: 'Project AI agents are disabled for this project.' },
        { status: 409 }
      );
    }

    if (!effectiveSettings.capabilities[kind]) {
      return NextResponse.json(
        { error: 'This agent capability is disabled for the project.' },
        { status: 409 }
      );
    }

    if (!runAvailability.canRun) {
      return NextResponse.json(
        {
          error: runAvailability.reason || 'Project agent run is blocked by configuration.',
          configIssue: runAvailability.blockingIssue,
          configIssues: runAvailability.issues,
        },
        { status: 409 }
      );
    }

    const result = await enqueueProjectAgentRun({
      projectId: access.project.id,
      organizationId: access.project.organizationId,
      projectKey: access.project.key,
      userId: session.user.id,
      kind,
      workspaceSettings,
      projectSettings,
      systemControl,
      dryRun,
      selectedModelConfig,
      idempotencyKey,
    });

    if (result.run.status === 'pending' || result.run.status === 'running') {
      const organizationId = access.project.organizationId;
      const authorizedProjectId = access.project.id;
      // Respond with the durable run id first. This is a latency optimization;
      // the scheduled reconciler remains authoritative if this callback dies.
      after(async () => {
        await processProjectAgentRunQueue({
          runId: result.run.id,
          organizationId,
          projectId: authorizedProjectId,
          limit: 1,
        }).catch((error) => {
          log.error({ err: error, runId: result.run.id }, 'project agent fast-path drain failed');
        });
      });
    }

    if (result.run.status === 'failed') {
      return NextResponse.json(result, { status: result.httpStatus || 500 });
    }

    return NextResponse.json(result, {
      status:
        result.run.status === 'pending' || result.run.status === 'running'
          ? 202
          : result.httpStatus || 200,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof ProjectAgentIdempotencyConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ProjectAgentAdmissionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }

    console.error('Failed to run project agent:', error);
    return NextResponse.json({ error: 'Failed to run project agent' }, { status: 500 });
  }
}
