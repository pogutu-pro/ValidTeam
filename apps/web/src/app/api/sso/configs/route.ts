/**
 * SSO configuration CRUD — requires organization settings permission.
 *
 *   GET   ?organizationId=xxx           → fetch existing config (without privateKey)
 *   POST  body: SsoConfigInput          → upsert config
 *   DELETE ?organizationId=xxx          → disable + delete config
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { auditLogs, db, ssoConfigs, eq, sql } from '@validteam/db';
import { z } from 'zod';
import { hasPermission } from '@/lib/auth/permissions';
import {
  certificateFingerprint,
  normalizeSamlCertificate,
  normalizeSamlEntryPoint,
  normalizeSamlPrivateKey,
  SamlConfigValidationError,
} from '@/lib/sso/config-validation';
import { protectSsoPrivateKey } from '@/lib/sso/private-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const upsertSchema = z.object({
  organizationId: z.string().min(1),
  provider: z.literal('saml').default('saml'),
  entryPointUrl: z.string().trim().min(1).max(4096),
  issuer: z.string().trim().min(1).max(2048),
  cert: z.string().trim().min(1).max(65_536),
  privateKey: z.string().max(32_768).optional(),
  clearPrivateKey: z.boolean().default(false),
  audience: z.string().trim().min(1).max(2048),
  attributeMap: z
    .object({
      email: z.string().trim().min(1).max(512),
      first_name: z.string().trim().max(512).default(''),
      last_name: z.string().trim().max(512).default(''),
      groups: z.string().trim().max(512).default(''),
    })
    .strict(),
  enabled: z.boolean().default(false),
});

function validationError(error: unknown) {
  if (!(error instanceof SamlConfigValidationError)) return null;
  return NextResponse.json({ error: error.code }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const orgId = new URL(request.url).searchParams.get('organizationId');
  if (!orgId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }
  if (!(await hasPermission(orgId, 'org:settings'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const [row] = await db
    .select()
    .from(ssoConfigs)
    .where(eq(ssoConfigs.workspaceId, orgId))
    .limit(1);
  if (!row) return NextResponse.json({ ssoConfig: null });
  // Never expose privateKey through the API.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { privateKey, ...safe } = row;
  return NextResponse.json({ ssoConfig: { ...safe, hasPrivateKey: !!privateKey } });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await hasPermission(parsed.data.organizationId, 'org:settings'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (parsed.data.clearPrivateKey && parsed.data.privateKey?.trim()) {
    return NextResponse.json({ error: 'private_key_action_conflict' }, { status: 400 });
  }

  let entryPointUrl: string;
  let cert: string;
  let privateKey: string | undefined;
  try {
    entryPointUrl = normalizeSamlEntryPoint(parsed.data.entryPointUrl);
    cert = normalizeSamlCertificate(parsed.data.cert);
    privateKey = parsed.data.privateKey?.trim()
      ? normalizeSamlPrivateKey(parsed.data.privateKey)
      : undefined;
  } catch (error) {
    const response = validationError(error);
    if (response) return response;
    throw error;
  }

  try {
    const saved = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`sso-config:${parsed.data.organizationId}`}))`
      );
      const [existing] = await tx
        .select()
        .from(ssoConfigs)
        .where(eq(ssoConfigs.workspaceId, parsed.data.organizationId))
        .limit(1)
        .for('update');

      const protectedPrivateKey = parsed.data.clearPrivateKey
        ? null
        : privateKey
          ? protectSsoPrivateKey(privateKey)
          : existing?.privateKey
            ? protectSsoPrivateKey(existing.privateKey)
            : null;
      const values = {
        workspaceId: parsed.data.organizationId,
        provider: parsed.data.provider,
        entryPointUrl,
        issuer: parsed.data.issuer,
        cert,
        privateKey: protectedPrivateKey,
        audience: parsed.data.audience,
        attributeMap: parsed.data.attributeMap,
        enabled: parsed.data.enabled,
        updatedAt: new Date(),
      };
      const [row] = existing
        ? await tx.update(ssoConfigs).set(values).where(eq(ssoConfigs.id, existing.id)).returning()
        : await tx.insert(ssoConfigs).values(values).returning();
      if (!row) throw new Error('sso_config_save_failed');

      await tx.insert(auditLogs).values({
        userId: session.user.id,
        organizationId: parsed.data.organizationId,
        action: existing ? 'sso_config.updated' : 'sso_config.created',
        resourceType: 'sso_config',
        resourceId: row.id,
        changes: {
          enabled: { from: existing?.enabled ?? null, to: row.enabled },
          entryPointUrl: { from: existing?.entryPointUrl ?? null, to: row.entryPointUrl },
          issuer: { from: existing?.issuer ?? null, to: row.issuer },
          audience: { from: existing?.audience ?? null, to: row.audience },
          certificateFingerprint: {
            from: certificateFingerprint(existing?.cert),
            to: certificateFingerprint(row.cert),
          },
          privateKeyConfigured: {
            from: Boolean(existing?.privateKey),
            to: Boolean(row.privateKey),
          },
          attributeMap: { from: existing?.attributeMap ?? null, to: row.attributeMap },
        },
        metadata: { provider: row.provider },
      });
      return row;
    });

    return NextResponse.json(
      {
        ok: true,
        ssoConfig: {
          id: saved.id,
          enabled: saved.enabled,
          hasPrivateKey: Boolean(saved.privateKey),
          updatedAt: saved.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('SSO configuration save failed:', error);
    return NextResponse.json({ error: 'sso_config_save_failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const orgId = new URL(request.url).searchParams.get('organizationId');
  if (!orgId) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }
  if (!(await hasPermission(orgId, 'org:settings'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sso-config:${orgId}`}))`);
      const [existing] = await tx
        .select()
        .from(ssoConfigs)
        .where(eq(ssoConfigs.workspaceId, orgId))
        .limit(1)
        .for('update');
      if (!existing) return false;
      await tx.delete(ssoConfigs).where(eq(ssoConfigs.id, existing.id));
      await tx.insert(auditLogs).values({
        userId: session.user.id,
        organizationId: orgId,
        action: 'sso_config.deleted',
        resourceType: 'sso_config',
        resourceId: existing.id,
        changes: { enabled: { from: existing.enabled, to: null } },
        metadata: {
          provider: existing.provider,
          certificateFingerprint: certificateFingerprint(existing.cert),
          privateKeyConfigured: Boolean(existing.privateKey),
        },
      });
      return true;
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error('SSO configuration deletion failed:', error);
    return NextResponse.json({ error: 'sso_config_delete_failed' }, { status: 500 });
  }
}
