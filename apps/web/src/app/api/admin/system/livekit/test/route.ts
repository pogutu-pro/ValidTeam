import { NextResponse } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { auth } from '@/auth';
import { isSuperAdmin } from '@/lib/auth/permissions';
import { db, systemAuditLogs } from '@validteam/db';
import { resolveLivekitConfig } from '@/lib/admin/system-settings';

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

export async function POST() {
  const authz = await requireAdmin();
  if ('error' in authz) return authz.error;

  const cfg = await resolveLivekitConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        success: false,
        error: 'livekit_not_configured',
        code: 'livekit_not_configured',
      },
      { status: 400 }
    );
  }

  const testId = createId();
  const testRoomName = `tn-admin-test-${createId()}`;
  await db.insert(systemAuditLogs).values({
    id: testId,
    userId: authz.userId,
    action: 'system.livekit_test_requested',
    resourceType: 'system_setting',
    resourceId: 'livekit_config',
    metadata: { testId, source: cfg.source, roomName: testRoomName },
  });

  let activeRoomCount: number;
  try {
    const roomService = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret, {
      requestTimeout: 5,
    });
    const rooms = await roomService.listRooms();
    activeRoomCount = rooms.length;

    const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
      identity: `admin-test-${authz.userId}`,
      name: 'Admin test',
    });
    token.addGrant({
      room: testRoomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
    });
    await token.toJwt();
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    try {
      await db.insert(systemAuditLogs).values({
        id: createId(),
        userId: authz.userId,
        action: 'system.livekit_test_failed',
        resourceType: 'system_setting',
        resourceId: 'livekit_config',
        metadata: { testId, source: cfg.source, error: message },
      });
    } catch (auditError) {
      console.error('[livekit-test] failed verification outcome could not be recorded', {
        testId,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
      return NextResponse.json(
        {
          success: false,
          error: 'livekit_test_outcome_unrecorded',
          code: 'livekit_test_outcome_unrecorded',
          testId,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'livekit_test_failed', code: 'livekit_test_failed' },
      { status: 502 }
    );
  }

  try {
    await db.insert(systemAuditLogs).values({
      id: createId(),
      userId: authz.userId,
      action: 'system.livekit_test_ok',
      resourceType: 'system_setting',
      resourceId: 'livekit_config',
      metadata: { testId, source: cfg.source, roomName: testRoomName, activeRoomCount },
    });
  } catch (error) {
    console.error('[livekit-test] verification succeeded but outcome audit could not be recorded', {
      testId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: 'livekit_test_outcome_unrecorded',
        code: 'livekit_test_outcome_unrecorded',
        testId,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    source: cfg.source,
    url: cfg.url,
    roomName: testRoomName,
    activeRoomCount,
    testId,
  });
}
