/**
 * Server helpers shared by the time-tracking route handlers.
 *
 * Centralises three things so each `route.ts` stays short:
 *   1. {@link assertIssueAccess} — auth + "can this user view this issue?".
 *   2. {@link recomputeActualHours} — keeps `issues.actual_hours` in sync with
 *      the sum of finalised `time_entries.duration_seconds` for the issue. We
 *      do this in app code (vs a trigger) because (a) Drizzle can't migrate a
 *      trigger cleanly and (b) the running-timer case is route-specific.
 *   3. {@link sumDurationSeconds} — convenience for analytics.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, issues, timeEntries } from '@tasknebula/db';
import { canReadIssue } from '@/lib/auth/access-control';

export type IssueAccessIssue = {
  id: string;
  projectId: string;
  organizationId: string;
  key: string;
  title: string;
};

export interface IssueAccessResult {
  ok: true;
  issue: IssueAccessIssue;
}

export interface IssueAccessFailure {
  ok: false;
  status: 401 | 403 | 404;
  reason: string;
}

/**
 * Verify the user can at least *view* the issue. We deliberately keep this
 * narrow — write permission for time entries is "any member of the issue's
 * project", which mirrors the existing comment policy.
 */
export async function assertIssueAccess(
  userId: string | undefined,
  issueId: string
): Promise<IssueAccessResult | IssueAccessFailure> {
  if (!userId) return { ok: false, status: 401, reason: 'Unauthorized' };

  const access = await canReadIssue(userId, issueId);
  if (!access.issue) return { ok: false, status: 404, reason: 'Issue not found' };
  if (!access.allowed) {
    return { ok: false, status: 403, reason: 'Not a project member' };
  }
  return {
    ok: true,
    issue: {
      id: access.issue.id,
      projectId: access.issue.projectId,
      organizationId: access.issue.organizationId,
      key: access.issue.key,
      title: access.issue.title,
    },
  };
}

/**
 * Recompute `issues.actual_hours` from the sum of finalised entries.
 *
 * We always run this after a create / stop / delete so the column matches the
 * underlying log. Running entries (`ended_at IS NULL`) are excluded — they
 * surface as the live timer in the UI but don't count toward "actual" yet.
 */
export async function recomputeActualHours(issueId: string): Promise<number> {
  const [row] = await db
    .select({
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.durationSeconds}), 0)::int`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.issueId, issueId), isNotNull(timeEntries.endedAt)));

  const totalSeconds = Number(row?.totalSeconds ?? 0);
  const hours = Math.round((totalSeconds / 3600) * 100) / 100;

  await db
    .update(issues)
    .set({ actualHours: hours.toFixed(2) })
    .where(eq(issues.id, issueId));

  return hours;
}

/**
 * Sum of finalised seconds for an issue. Cheap helper used by burndown.
 */
export async function sumDurationSeconds(issueId: string): Promise<number> {
  const [row] = await db
    .select({
      totalSeconds: sql<number>`COALESCE(SUM(${timeEntries.durationSeconds}), 0)::int`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.issueId, issueId), isNotNull(timeEntries.endedAt)));
  return Number(row?.totalSeconds ?? 0);
}
