import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import {
  agentProviders,
  and,
  auditLogs,
  db,
  eq,
  inArray,
  organizations,
  sql,
  systemAuditLogs,
} from '@validteam/db';
import { generateAgentSecret, type AgentProviderKind } from '@/lib/agents/sessions';
import { getLocalAgentRunnerStatus } from '@/lib/agents/local-runner';

export const dynamic = 'force-dynamic';

const LOCAL_PROVIDER_VALUES = ['claude', 'codex'] as const;

const patchSchema = z.object({
  organizationId: z.string().min(1),
  provider: z.enum(LOCAL_PROVIDER_VALUES),
  enabled: z.boolean(),
});

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = await isSuperAdmin();
  if (!admin) {
    return {
      response: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    };
  }

  return { session };
}

async function ensureOrganization(organizationId: string) {
  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organization ?? null;
}

async function loadLocalProviders(organizationId: string) {
  const rows = await db
    .select()
    .from(agentProviders)
    .where(
      and(
        eq(agentProviders.workspaceId, organizationId),
        inArray(agentProviders.provider, [...LOCAL_PROVIDER_VALUES])
      )
    );

  return LOCAL_PROVIDER_VALUES.map((provider) => {
    const row = rows.find((item) => item.provider === provider) ?? null;
    const status = getLocalAgentRunnerStatus(
      provider as AgentProviderKind,
      row?.endpointUrl ?? null,
      row?.enabled ?? false
    );

    return {
      provider,
      enabled: Boolean(row?.enabled),
      endpointMode: row?.endpointUrl?.startsWith('local://') ? 'local_cli' : 'webhook',
      configured: Boolean(status?.configured),
      command: status?.command ?? provider,
      cwd: status?.cwd ?? process.cwd(),
      model: status?.model ?? null,
      timeoutSeconds: status?.timeoutSeconds ?? null,
      mode: status?.mode ?? null,
      reasonCode: status?.reasonCode ?? null,
      reasonDetail: status?.reasonDetail ?? null,
      enabledByEnv: Boolean(status?.enabledByEnv),
      enabledByProvider: Boolean(status?.enabledByProvider),
    };
  });
}

export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }

  const organization = await ensureOrganization(organizationId);
  if (!organization) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  return NextResponse.json({
    organization,
    providers: await loadLocalProviders(organizationId),
  });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if ('response' in guard) return guard.response;

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`validteam:local-runner:${parsed.organizationId}:${parsed.provider}`}))`
    );
    const [organization] = await tx
      .select({ id: organizations.id, name: organizations.name, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, parsed.organizationId))
      .limit(1);
    if (!organization) return { kind: 'not_found' as const };
    if (organization.status === 'suspended' && parsed.enabled) {
      return { kind: 'suspended' as const };
    }

    const [existing] = await tx
      .select()
      .from(agentProviders)
      .where(
        and(
          eq(agentProviders.workspaceId, parsed.organizationId),
          eq(agentProviders.provider, parsed.provider)
        )
      )
      .limit(1)
      .for('update');
    const hmacSecret = existing?.hmacSecret || generateAgentSecret();

    await tx
      .insert(agentProviders)
      .values({
        id: existing?.id ?? createId(),
        workspaceId: parsed.organizationId,
        provider: parsed.provider,
        endpointUrl: `local://${parsed.provider}`,
        hmacSecret,
        enabled: parsed.enabled,
      })
      .onConflictDoUpdate({
        target: [agentProviders.workspaceId, agentProviders.provider],
        set: {
          endpointUrl: `local://${parsed.provider}`,
          enabled: parsed.enabled,
          hmacSecret,
          updatedAt: new Date(),
        },
      });

    const changes = {
      enabled: { from: existing?.enabled ?? false, to: parsed.enabled },
      endpointMode: {
        from: existing
          ? existing.endpointUrl.startsWith('local://')
            ? 'local_cli'
            : 'webhook'
          : null,
        to: 'local_cli',
      },
    };
    const metadata = { kind: 'local_agent_runner', provider: parsed.provider };
    await tx.insert(auditLogs).values({
      id: createId(),
      userId: guard.session.user.id,
      organizationId: parsed.organizationId,
      action: 'agent.config_updated',
      resourceType: 'agent_provider',
      resourceId: `${parsed.organizationId}:${parsed.provider}`,
      changes,
      metadata,
    });
    await tx.insert(systemAuditLogs).values({
      id: createId(),
      userId: guard.session.user.id,
      action: 'agent.local_runner_updated',
      resourceType: 'agent_provider',
      resourceId: `${parsed.organizationId}:${parsed.provider}`,
      organizationId: parsed.organizationId,
      changes,
      metadata,
    });

    return { kind: 'updated' as const, organization };
  });

  if (result.kind === 'not_found') {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  if (result.kind === 'suspended') {
    return NextResponse.json({ error: 'organization_suspended' }, { status: 409 });
  }

  return NextResponse.json({
    organization: result.organization,
    providers: await loadLocalProviders(parsed.organizationId),
  });
}
