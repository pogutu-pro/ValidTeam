import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, importJobs } from '@tasknebula/db';
import { isImportSource, type ImportSource } from '@/lib/importers';
import { executeImportJob } from '@/lib/importers/runner';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

export const dynamic = 'force-dynamic';

type MappingRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MappingRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactRecord(record: MappingRecord): MappingRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

async function canCreateImportedIssues(args: {
  userId: string;
  workspaceId: string;
  projectId: string;
}): Promise<{ allowed: boolean; status: 403 | 404; error: string }> {
  const { userId, workspaceId, projectId } = args;

  const access = await resolveProjectCapabilityAccess(userId, projectId);
  if (!access.project || access.project.organizationId !== workspaceId) {
    return { allowed: false, status: 404, error: 'Project not found' };
  }
  if (!access.canRead) {
    return { allowed: false, status: 403, error: 'Forbidden' };
  }
  if (access.canManage || access.permissions.canCreateIssues) {
    return { allowed: true, status: 403, error: '' };
  }
  return {
    allowed: false,
    status: 403,
    error: 'Insufficient permissions to create imported issues',
  };
}

function sanitizeConfig(source: ImportSource, config: MappingRecord): MappingRecord {
  switch (source) {
    case 'linear':
      return compactRecord({
        teamKey: typeof config.teamKey === 'string' ? config.teamKey : undefined,
        first: typeof config.first === 'number' ? config.first : undefined,
      });
    case 'jira':
      return compactRecord({
        site: typeof config.site === 'string' ? config.site : undefined,
        email: typeof config.email === 'string' ? config.email : undefined,
        jql: typeof config.jql === 'string' ? config.jql : undefined,
        maxResults: typeof config.maxResults === 'number' ? config.maxResults : undefined,
      });
    case 'github':
      return compactRecord({
        owner: typeof config.owner === 'string' ? config.owner : undefined,
        repo: typeof config.repo === 'string' ? config.repo : undefined,
        perPage: typeof config.perPage === 'number' ? config.perPage : undefined,
        maxPages: typeof config.maxPages === 'number' ? config.maxPages : undefined,
      });
    case 'csv':
      return {};
    default:
      return {};
  }
}

function buildRuntimeSourceInput(source: ImportSource, config: MappingRecord): unknown | undefined {
  if (source === 'csv') return undefined;
  return config;
}

/**
 * POST /api/import/[source]/run
 *
 * Creates an `import_jobs` row in 'pending' state and kicks off the
 * runner asynchronously. Returns the job id immediately so the UI can
 * start polling `/api/import/jobs/[id]` for progress.
 *
 * Request body:
 *   {
 *     workspaceId: string,    // required
 *     projectId:   string,    // target project for imported issues
 *     mapping:     ImportMapping & adapter-specific config,
 *     csvText?:    string,    // CSV only — raw payload
 *   }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { source } = await params;
  if (!isImportSource(source)) {
    return NextResponse.json({ error: `Unknown import source: ${source}` }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null;
  const projectId = typeof body.projectId === 'string' ? body.projectId : null;
  if (!workspaceId || !projectId) {
    return NextResponse.json({ error: 'workspaceId and projectId are required' }, { status: 400 });
  }

  const importAccess = await canCreateImportedIssues({
    userId: session.user.id,
    workspaceId,
    projectId,
  });
  if (!importAccess.allowed) {
    return NextResponse.json({ error: importAccess.error }, { status: importAccess.status });
  }

  const bodyMapping = isRecord(body.mapping) ? body.mapping : {};
  const bodyConfig = isRecord(bodyMapping.config) ? bodyMapping.config : {};
  const runtimeSourceInput = buildRuntimeSourceInput(source, bodyConfig);
  const sanitizedConfig = sanitizeConfig(source, bodyConfig);
  const mapping = {
    ...bodyMapping,
    config: sanitizedConfig,
    projectId,
    // For CSV, stash the raw text inside mapping so the runner can
    // re-parse without a separate object store. For other sources we
    // keep only non-secret config; credentials stay in memory for the
    // immediate in-process runner call below.
    csvText: source === 'csv' && typeof body.csvText === 'string' ? body.csvText : undefined,
  };
  for (const key of [
    'preview',
    'apiKey',
    'apiToken',
    'accessToken',
    'refreshToken',
    'clientSecret',
    'password',
    'authorization',
  ]) {
    delete (mapping as MappingRecord)[key];
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      workspaceId,
      source,
      status: 'pending',
      mapping,
      createdBy: session.user.id,
    })
    .returning();

  if (!job) {
    return NextResponse.json({ error: 'Failed to create import job' }, { status: 500 });
  }

  // Fire-and-forget. When a real queue lands (BullMQ / pg-boss), replace
  // this with an enqueue call.
  const jobId = job.id;
  void executeImportJob(jobId, runtimeSourceInput).catch((err) => {
    console.error('[import] runner failed', jobId, err);
  });

  return NextResponse.json({ jobId, status: job.status }, { status: 201 });
}
