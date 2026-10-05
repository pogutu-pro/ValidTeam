import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createId as cuid } from '@paralleldrive/cuid2';
import { and, db, documentPageAttachments, eq, sql } from '@validteam/db';
import { resolveDocumentPageAccess } from '@/lib/docs/server';
import { resolveStorageConfig, STORAGE_CONFIG_ADVISORY_LOCK } from '@/lib/admin/system-settings';
import {
  createStoredFilename,
  deleteStoredFile,
  storedFilenameFromPath,
  writeStoredFile,
} from '@/lib/storage/blob-store';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { pageId } = await params;
    const access = await resolveDocumentPageAccess(session.user.id, pageId);
    if (!access?.permissions.canBrowse) {
      return NextResponse.json({ error: 'Page not found or unavailable' }, { status: 404 });
    }

    const attachments = await db
      .select()
      .from(documentPageAttachments)
      .where(eq(documentPageAttachments.pageId, pageId));

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error('Error fetching document attachments:', error);
    return NextResponse.json({ error: 'Failed to fetch document attachments' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { pageId } = await params;
    const access = await resolveDocumentPageAccess(session.user.id, pageId);
    if (!access?.permissions.canEdit) {
      return NextResponse.json(
        { error: 'You do not have permission to upload files to this page' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
    }

    const fileId = cuid();
    const fileName = createStoredFilename(fileId, file.name);
    const bytes = await file.arrayBuffer();
    const attachment = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );
      const storageConfig = await resolveStorageConfig();
      await writeStoredFile(fileName, Buffer.from(bytes), file.type, storageConfig);

      try {
        const [created] = await tx
          .insert(documentPageAttachments)
          .values({
            id: fileId,
            pageId,
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

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('Error uploading document attachment:', error);
    return NextResponse.json({ error: 'Failed to upload document attachment' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { pageId } = await params;
    const access = await resolveDocumentPageAccess(session.user.id, pageId);
    if (!access?.permissions.canEdit && !access?.permissions.canDelete) {
      return NextResponse.json(
        { error: 'You do not have permission to delete attachments from this page' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('attachmentId');

    if (!attachmentId) {
      return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 });
    }

    const [attachment] = await db
      .select({ filePath: documentPageAttachments.filePath })
      .from(documentPageAttachments)
      .where(
        and(
          eq(documentPageAttachments.id, attachmentId),
          eq(documentPageAttachments.pageId, pageId)
        )
      )
      .limit(1);

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(hashtext(${STORAGE_CONFIG_ADVISORY_LOCK}))`
      );
      const storageConfig = await resolveStorageConfig();
      await deleteStoredFile(storedFilenameFromPath(attachment.filePath), storageConfig);
      await tx.delete(documentPageAttachments).where(eq(documentPageAttachments.id, attachmentId));
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting document attachment:', error);
    return NextResponse.json({ error: 'Failed to delete document attachment' }, { status: 500 });
  }
}
