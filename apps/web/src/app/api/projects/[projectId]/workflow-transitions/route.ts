import { NextRequest, NextResponse } from 'next/server';
import { db, workflows, workflowStatuses, workflowTransitions } from '@tasknebula/db';
import { auth } from '@/auth';
import { eq, and } from 'drizzle-orm';
import { resolveProjectByIdOrKey } from '@/lib/projects/server';
import { canManageProject, canReadProject } from '@/lib/auth/access-control';
import { z } from 'zod';

const transitionInputSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  fromStatusId: z.string().min(1).max(128),
  toStatusId: z.string().min(1).max(128),
  allowedRoles: z
    .array(z.enum(['admin', 'member', 'guest']))
    .min(1)
    .max(3)
    .default(['admin', 'member']),
  requiresApproval: z.boolean().default(false),
  approverRoles: z
    .array(z.enum(['admin', 'member']))
    .min(1)
    .max(2)
    .default(['admin']),
  approvedTargetStatusId: z.string().min(1).max(128).nullish(),
  rejectedTargetStatusId: z.string().min(1).max(128).nullish(),
  conditions: z.unknown().default([]),
  validators: z.unknown().default([]),
  postActions: z.unknown().default([]),
});

const replaceTransitionsSchema = z.object({
  transitions: z.array(transitionInputSchema).max(500),
});

async function resolveWorkflowId(project: {
  id: string;
  organizationId: string;
  defaultWorkflowId: string | null;
}) {
  if (project.defaultWorkflowId) {
    const [projectWorkflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, project.defaultWorkflowId),
          eq(workflows.organizationId, project.organizationId)
        )
      )
      .limit(1);
    return projectWorkflow?.id ?? null;
  }
  const [defaultWorkflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.organizationId, project.organizationId), eq(workflows.isDefault, true)))
    .limit(1);
  return defaultWorkflow?.id ?? null;
}

// GET /api/projects/[projectId]/workflow-transitions
// Returns the transition rules for the project's workflow.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const project = await resolveProjectByIdOrKey(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 404 (not 403) so cross-org probing cannot confirm the project exists
    const canRead = await canReadProject(session.user.id, project);
    if (!canRead) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const workflowId = await resolveWorkflowId(project);
    if (!workflowId) {
      return NextResponse.json({ transitions: [], statuses: [] });
    }

    const statuses = await db
      .select()
      .from(workflowStatuses)
      .where(eq(workflowStatuses.workflowId, workflowId));

    const transitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, workflowId));

    return NextResponse.json({ statuses, transitions });
  } catch (error) {
    console.error('Failed to load workflow transitions', error);
    return NextResponse.json({ error: 'Failed to load workflow transitions' }, { status: 500 });
  }
}

// PUT /api/projects/[projectId]/workflow-transitions
// Body is validated by replaceTransitionsSchema and replaces the workflow's
// transitions in one transaction.
// Replaces all transitions for the workflow atomically.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const project = await resolveProjectByIdOrKey(projectId, session.user.id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 404 (not 403) so cross-org probing cannot confirm the project exists
    const canRead = await canReadProject(session.user.id, project);
    if (!canRead) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const canManage = await canManageProject(session.user.id, project);
    if (!canManage) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const workflowId = await resolveWorkflowId(project);
    if (!workflowId) {
      return NextResponse.json(
        { error: 'Workflow not configured for this project' },
        { status: 400 }
      );
    }

    const body = replaceTransitionsSchema.parse(await request.json());

    const workflowStatusRows = await db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(eq(workflowStatuses.workflowId, workflowId));
    const validStatusIds = new Set(workflowStatusRows.map((s) => s.id));

    const normalized = body.transitions.map((raw) => {
      if (!validStatusIds.has(raw.fromStatusId) || !validStatusIds.has(raw.toStatusId)) {
        throw new Error('transition references an unknown status for this workflow');
      }
      if (raw.approvedTargetStatusId && !validStatusIds.has(raw.approvedTargetStatusId)) {
        throw new Error('approved target references an unknown status for this workflow');
      }
      if (raw.rejectedTargetStatusId && !validStatusIds.has(raw.rejectedTargetStatusId)) {
        throw new Error('rejected target references an unknown status for this workflow');
      }
      return {
        workflowId,
        name:
          typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim()
            : `Transition ${raw.fromStatusId} → ${raw.toStatusId}`,
        fromStatusId: raw.fromStatusId,
        toStatusId: raw.toStatusId,
        allowedRoles: raw.allowedRoles,
        requiresApproval: raw.requiresApproval,
        approverRoles: raw.approverRoles,
        approvedTargetStatusId: raw.requiresApproval
          ? (raw.approvedTargetStatusId ?? raw.toStatusId)
          : null,
        rejectedTargetStatusId: raw.requiresApproval
          ? (raw.rejectedTargetStatusId ?? raw.fromStatusId)
          : null,
        conditions: raw.conditions,
        validators: raw.validators,
        postActions: raw.postActions,
      };
    });

    // Replace all transitions for this workflow in a single pass.
    await db.transaction(async (tx) => {
      await tx.delete(workflowTransitions).where(eq(workflowTransitions.workflowId, workflowId));
      if (normalized.length > 0) {
        await tx.insert(workflowTransitions).values(normalized);
      }
    });

    const saved = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, workflowId));

    return NextResponse.json({ transitions: saved });
  } catch (error) {
    console.error('Failed to save workflow transitions', error);
    const message =
      error instanceof z.ZodError
        ? 'Invalid workflow transition payload'
        : error instanceof Error
          ? error.message
          : 'Failed to save workflow transitions';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
