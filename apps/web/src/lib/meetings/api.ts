/** Shared plumbing for the /api/meetings routes. */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { db, users, eq, type Meeting } from '@validteam/db';
import { resolveApiActor, type ApiActor } from '@/lib/auth/api-actor';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { MeetingError } from './errors';
import { resolveMemberPrincipal, type MemberPrincipal } from './access';
import { getMeetingBySlug } from './service';

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof MeetingError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status }
    );
  }
  console.error('[meetings] unexpected error:', error instanceof Error ? error.message : error);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Internal error' } },
    { status: 500 }
  );
}

export async function requireActor(request: Request): Promise<ApiActor> {
  const actor = await resolveApiActor(request);
  if (!actor) throw new MeetingError('unauthorized', 401, 'Unauthorized');
  return actor;
}

export async function parseJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new MeetingError('INVALID_JSON', 400, 'Invalid JSON body');
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new MeetingError('VALIDATION_FAILED', 400, 'Validation failed', result.error.issues);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(request: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) {
    throw new MeetingError('VALIDATION_FAILED', 400, 'Validation failed', result.error.issues);
  }
  return result.data;
}

/** Resolve the meeting + member principal, or 404 (never reveal other orgs' meetings). */
export async function loadMeetingForMember(
  request: Request,
  slug: string
): Promise<{ actor: ApiActor; meeting: Meeting; principal: MemberPrincipal }> {
  const actor = await requireActor(request);
  const meeting = await getMeetingBySlug(slug);
  const principal = meeting
    ? await resolveMemberPrincipal(actor.userId, meeting, {
        apiKeyOrganizationId: actor.organizationId,
      })
    : null;
  if (!meeting || !principal) throw new MeetingError('not_found', 404, 'Meeting not found');
  return { actor, meeting, principal };
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const r = checkRateLimit(key, limit, windowMs);
  if (!r.allowed) {
    throw new MeetingError('rate_limited', 429, 'Too many requests', {
      retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000),
    });
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function displayNameFor(userId: string): Promise<string> {
  const [u] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.name?.trim() || u?.email || 'Participant';
}

export function meetingSummary(m: Meeting) {
  return {
    slug: m.slug,
    title: m.title,
    description: m.description,
    status: m.status,
    isInstant: m.isInstant,
    isRecurring: m.seriesId !== null,
    access: m.access,
    allowGuests: m.allowGuests,
    timezone: m.timezone,
    scheduledStartAt: m.scheduledStartAt,
    scheduledEndAt: m.scheduledEndAt,
    actualStartedAt: m.actualStartedAt,
    endedAt: m.endedAt,
    joinPath: `/meet/${m.slug}`,
    // Reserved for later phases; always 'none' while those features are inactive.
    recordingStatus: m.recordingStatus,
    transcriptionStatus: m.transcriptionStatus,
    captionStatus: m.captionStatus,
  };
}
