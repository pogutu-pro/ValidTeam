import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { getProjectAgentAccess } from '@/lib/agents/access';
import { processProjectAgentRunQueue } from '@/lib/agents/engine';
import {
  ProjectAgentAdmissionError,
  ProjectAgentResumeConflict,
  requestProjectAgentRunCancellation,
  resumeProjectAgentRun,
  serializeProjectAgentRun,
} from '@/lib/agents/project-agent-run-store';
import { getSystemAgentControlSettingsFromDb } from '@/lib/agents/system';
import { aiDisabledResponse, isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { childLogger } from '@/lib/logger';

const log = childLogger('api/projects/agents/runs/control');

const actionSchema = z.object({ action: z.enum(['resume', 'cancel']) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; runId: string }> }
) {
  if (!(await isAiFeatureEnabled())) return aiDisabledResponse();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { projectId, runId } = await params;
  const access = await getProjectAgentAccess(session.user.id, projectId);
  if (!access.canManage || !access.project) {
    return NextResponse.json(
      { error: 'You do not have permission to manage project agent runs.' },
      { status: 403 }
    );
  }

  try {
    const { action } = actionSchema.parse(await request.json());
    const scope = {
      runId,
      organizationId: access.project.organizationId,
      projectId: access.project.id,
    };
    if (action === 'cancel') {
      const run = await requestProjectAgentRunCancellation(scope);
      if (!run) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
      return NextResponse.json({ run: serializeProjectAgentRun(run) });
    }

    const systemControl = await getSystemAgentControlSettingsFromDb();
    const resumed = await resumeProjectAgentRun({
      ...scope,
      maxConcurrentRuns: systemControl.maxConcurrentRuns,
    });
    if (!resumed) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
    after(async () => {
      await processProjectAgentRunQueue({
        runId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        limit: 1,
      }).catch((error) => {
        log.error({ err: error, runId }, 'resumed project agent fast-path drain failed');
      });
    });
    return NextResponse.json({ run: serializeProjectAgentRun(resumed) }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof ProjectAgentResumeConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ProjectAgentAdmissionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }
    console.error('Failed to control project agent run:', error);
    return NextResponse.json({ error: 'Failed to control project agent run' }, { status: 500 });
  }
}
