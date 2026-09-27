import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { attachments, db, sql } from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import { createId as cuid } from '@paralleldrive/cuid2';
import { canEditIssue, canReadIssue } from '@/lib/auth/access-control';
import { resolveStorageConfig, STORAGE_CONFIG_ADVISORY_LOCK } from '@/lib/admin/system-settings';
import {
  createStoredFilename,
  deleteStoredFile,
  storedFilenameFromPath,
  writeStoredFile,
} from '@/lib/storage/blob-store';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Assert the caller is allowed to access attachments for this issue.
 * Access = organization project management permission or any project member of the issue's project.
 * Returns the issue row when allowed, null when the issue is missing, or throws NextResponse-like errors via a status.
 */
async function assertIssueAccess(userId: string, issueId: string, mode: 'read' | 'edit' = 'read') {
  const access =
    mode === 'edit' ? await canEditIssue(userId, issueId) : await canReadIssue(userId, issueId);
  if (!access.issue) {
    return { status: 404 as const, error: 'Issue not found', issue: null };
  }
  return access.allowed
    ? { status: 200 as const, issue: access.issue }
    : { status: 403 as const, error: 'Forbidden', issue: null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId } = await params;

    const access = await assertIssueAccess(session.user.id, issueId);
    if (access.status !== 200) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Fetch attachments for the issue
    const issueAttachments = await db
      .select()
      .from(attachments)
      .where(eq(attachments.issueId, issueId));

    return NextResponse.json({ attachments: issueAttachments });
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId } = await params;

    const access = await assertIssueAccess(session.user.id, issueId, 'edit');
    if (access.status !== 200) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
    }

    // Generate unique filename
    const fileId = cuid();
    const fileName = createStoredFilename(fileId, file.name);

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const attachment = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );
      const storageConfig = await resolveStorageConfig();
      await writeStoredFile(fileName, buffer, file.type, storageConfig);

      try {
        const [created] = await tx
          .insert(attachments)
          .values({
            id: fileId,
            issueId,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            filePath: `/uploads/${fileName}`,
            uploadedById: session.user.id,
          })
          .returning();
        return created;
      } catch (error) {
        await deleteStoredFile(fileName, storageConfig).catch(() => undefined);
        throw error;
      }
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { issueId } = await params;

    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('attachmentId');

    if (!attachmentId) {
      return NextResponse.json({ error: 'Attachment ID required' }, { status: 400 });
    }

    // Look up the attachment and verify it belongs to the issue in the URL
    const [attachment] = await db
      .select({ id: attachments.id, issueId: attachments.issueId, filePath: attachments.filePath })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1);

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (attachment.issueId !== issueId) {
      return NextResponse.json(
        { error: 'Attachment does not belong to this issue' },
        { status: 400 }
      );
    }

    // Permission check against the owning issue's project/org
    const access = await assertIssueAccess(session.user.id, attachment.issueId, 'edit');
    if (access.status !== 200) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );
      const storageConfig = await resolveStorageConfig();
      await deleteStoredFile(storedFilenameFromPath(attachment.filePath), storageConfig);
      await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
