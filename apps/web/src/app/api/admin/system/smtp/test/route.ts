import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { db, systemAuditLogs, users, eq } from '@validteam/db';
import { resolveSmtpConfig } from '@/lib/admin/system-settings';
import { getTranslations } from 'next-intl/server';

const bodySchema = z
  .object({
    to: z.string().trim().email().optional(),
  })
  .optional();

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  const admin = await isSuperAdmin();
  if (!admin) {
    return {
      error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }),
    } as const;
  }
  return { userId: session.user.id } as const;
}

export async function POST(request: NextRequest) {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: 'smtp_test_recipient_invalid', code: 'smtp_test_recipient_invalid' },
      { status: 400 }
    );
  }
  const desiredTo = parsedBody.data?.to;

  // Default to the admin's own email when no explicit recipient given.
  let recipient = desiredTo;
  if (!recipient) {
    const [admin] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, authz.userId))
      .limit(1);
    recipient = admin?.email || undefined;
  }

  if (!recipient) {
    return NextResponse.json(
      { success: false, error: 'smtp_test_recipient_missing', code: 'smtp_test_recipient_missing' },
      { status: 400 }
    );
  }

  const cfg = await resolveSmtpConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        success: false,
        error: 'smtp_not_configured',
        code: 'smtp_not_configured',
      },
      { status: 400 }
    );
  }

  const testId = createId();
  const insecureTls = process.env.SMTP_ALLOW_INSECURE_TLS === 'true';
  await db.insert(systemAuditLogs).values({
    id: testId,
    userId: authz.userId,
    action: 'system.smtp_test_requested',
    resourceType: 'system_setting',
    resourceId: 'smtp_config',
    metadata: { testId, recipient, source: cfg.source, insecureTls },
  });

  let messageId: string | undefined;
  try {
    const nodemailer = await import('nodemailer');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transportOptions: Record<string, any> = {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
    };
    if (insecureTls) transportOptions.tls = { rejectUnauthorized: false };
    if (cfg.user && cfg.password) {
      transportOptions.auth = { user: cfg.user, pass: cfg.password };
    }
    const transport = nodemailer.default.createTransport(transportOptions);
    const t = await getTranslations('adminPanels.systemCredentials.smtp');
    const info = await transport.sendMail({
      from: cfg.emailFrom,
      to: recipient,
      subject: t('testEmailSubject'),
      text: t('testEmailText', { source: cfg.source }),
    });
    messageId = info.messageId;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    try {
      await db.insert(systemAuditLogs).values({
        id: createId(),
        userId: authz.userId,
        action: 'system.smtp_test_failed',
        resourceType: 'system_setting',
        resourceId: 'smtp_config',
        metadata: { testId, recipient, source: cfg.source, error: message },
      });
    } catch (auditError) {
      console.error('[smtp-test] failed delivery outcome could not be recorded', {
        testId,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
      return NextResponse.json(
        {
          success: false,
          error: 'smtp_test_outcome_unrecorded',
          code: 'smtp_test_outcome_unrecorded',
          deliveryUncertain: true,
          testId,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'smtp_test_failed', code: 'smtp_test_failed' },
      { status: 502 }
    );
  }

  try {
    await db.insert(systemAuditLogs).values({
      id: createId(),
      userId: authz.userId,
      action: 'system.smtp_test_sent',
      resourceType: 'system_setting',
      resourceId: 'smtp_config',
      metadata: { testId, recipient, source: cfg.source, messageId },
    });
  } catch (error) {
    console.error('[smtp-test] email sent but outcome audit could not be recorded', {
      testId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: 'smtp_test_outcome_unrecorded',
        code: 'smtp_test_outcome_unrecorded',
        deliveryUncertain: true,
        testId,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    source: cfg.source,
    messageId,
    recipient,
    testId,
  });
}
