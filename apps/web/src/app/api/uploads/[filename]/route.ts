import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, attachments, documentPageAttachments } from '@validteam/db';
import { eq } from 'drizzle-orm';
import { canReadIssue } from '@/lib/auth/access-control';
import { resolveDocumentPageAccess } from '@/lib/docs/server';
import {
  attachmentContentDisposition,
  readStoredFile,
  StorageObjectNotFoundError,
  validateStoredFilename,
} from '@/lib/storage/blob-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filename } = await params;

    try {
      validateStoredFilename(filename);
    } catch {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    // Resolve the owning record (attachment or document page attachment)
    // Both store filePath as `/uploads/<filename>`
    const storedPath = `/uploads/${filename}`;

    const access = await resolveFileAccess(session.user.id, storedPath);
    if (access.result === 'not_found') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (access.result === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (access.result !== 'ok') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    try {
      const fileBuffer = await readStoredFile(filename);
      const contentType = access.mimeType || getContentType(filename.split('.').pop() || '');

      return new NextResponse(new Uint8Array(fileBuffer), {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': attachmentContentDisposition(access.fileName),
          'Content-Security-Policy': 'sandbox',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (!(error instanceof StorageObjectNotFoundError)) throw error;
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type FileAccess =
  | { result: 'not_found' }
  | { result: 'forbidden' }
  | { result: 'ok'; fileName: string; mimeType: string | null };

async function resolveFileAccess(userId: string, storedPath: string): Promise<FileAccess> {
  // Try issue attachment first
  const [issueAttachment] = await db
    .select({
      id: attachments.id,
      issueId: attachments.issueId,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
    })
    .from(attachments)
    .where(eq(attachments.filePath, storedPath))
    .limit(1);

  if (issueAttachment) {
    const access = await canReadIssue(userId, issueAttachment.issueId);
    if (!access.issue) return { result: 'not_found' };
    return access.allowed
      ? {
          result: 'ok',
          fileName: issueAttachment.fileName,
          mimeType: issueAttachment.mimeType,
        }
      : { result: 'forbidden' };
  }

  // Try document page attachment
  const [pageAttachment] = await db
    .select({
      id: documentPageAttachments.id,
      pageId: documentPageAttachments.pageId,
      fileName: documentPageAttachments.fileName,
      mimeType: documentPageAttachments.mimeType,
    })
    .from(documentPageAttachments)
    .where(eq(documentPageAttachments.filePath, storedPath))
    .limit(1);

  if (pageAttachment) {
    const access = await resolveDocumentPageAccess(userId, pageAttachment.pageId);
    if (!access) return { result: 'not_found' };
    return access.permissions.canBrowse
      ? {
          result: 'ok',
          fileName: pageAttachment.fileName,
          mimeType: pageAttachment.mimeType,
        }
      : { result: 'forbidden' };
  }

  return { result: 'not_found' };
}

function getContentType(ext: string): string {
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  return contentTypes[ext] || 'application/octet-stream';
}
