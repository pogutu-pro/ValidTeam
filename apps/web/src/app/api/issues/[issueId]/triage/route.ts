/**
 * POST /api/issues/[issueId]/triage
 *
 * Runs the Triage Intelligence agent for the issue and persists the
 * structured proposal into `issue_triage_suggestions`. Idempotent in the
 * loose sense that running it twice creates two rows — that's intentional
 * so we can compare agent output across model upgrades.
 *
 * Permissions: any caller who can view the issue may request a triage
 * proposal. Applying it is gated separately by /triage/apply.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, desc, eq, getIssueById, issueTriageSuggestions } from '@validteam/db';
import { auth } from '@/auth';
import { triageIssue } from '@/lib/agents/triage';
import { AiDraftError } from '@/lib/ai/draft-issue';
import { resolveProjectAccess } from '@/lib/auth/project-access';

async function callerCanView(userId: string, projectId: string): Promise<boolean> {
  return (await resolveProjectAccess(userId, projectId)).canRead;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { issueId } = await params;

    const issue = await getIssueById(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    if (!(await callerCanView(session.user.id, issue.projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { suggestion } = await triageIssue(issueId);

    const [inserted] = await db
      .insert(issueTriageSuggestions)
      .values({
        issueId,
        payload: suggestion,
        confidence: suggestion.confidence,
      })
      .returning();

    return NextResponse.json(
      {
        suggestion: inserted,
        payload: suggestion,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AiDraftError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'issue_not_found' ? 404 : 502 }
      );
    }
    console.error('triage endpoint failed:', error);
    return NextResponse.json({ error: 'Failed to run triage' }, { status: 500 });
  }
}

/**
 * GET /api/issues/[issueId]/triage
 *
 * Returns the most recent suggestions for an issue (newest first, max 10).
 * UI uses this to render the suggestion panel without re-running the LLM.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { issueId } = await params;

    const issue = await getIssueById(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    if (!(await callerCanView(session.user.id, issue.projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await db
      .select()
      .from(issueTriageSuggestions)
      .where(eq(issueTriageSuggestions.issueId, issueId))
      .orderBy(desc(issueTriageSuggestions.createdAt))
      .limit(10);
    return NextResponse.json({ suggestions: rows });
  } catch (error) {
    console.error('triage list endpoint failed:', error);
    return NextResponse.json({ error: 'Failed to load triage suggestions' }, { status: 500 });
  }
}
