import { NextRequest, NextResponse } from 'next/server';
import { and, db, documentPageAttachments, documentPages, eq } from '@tasknebula/db';
import {
  attachmentContentDisposition,
  readStoredFile,
  StorageObjectNotFoundError,
  storedFilenameFromPath,
} from '@/lib/storage/blob-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; attachmentId: string }> }
) {
  try {
    const { token, attachmentId } = await params;

    const [page] = await db
      .select({
        id: documentPages.id,
        publicShareIncludeAttachments: documentPages.publicShareIncludeAttachments,
      })
      .from(documentPages)
      .where(
        and(
          eq(documentPages.publicShareToken, token),
          eq(documentPages.publicShareEnabled, true),
          eq(documentPages.isArchived, false)
        )
      )
      .limit(1);

    if (!page || !page.publicShareIncludeAttachments) {
      return NextResponse.json({ error: 'Attachment not available' }, { status: 404 });
    }

    const [attachment] = await db
      .select()
      .from(documentPageAttachments)
      .where(
        and(
          eq(documentPageAttachments.id, attachmentId),
          eq(documentPageAttachments.pageId, page.id)
        )
      )
      .limit(1);

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const filename = storedFilenameFromPath(attachment.filePath);
    const fileBuffer = await readStoredFile(filename);

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Disposition': attachmentContentDisposition(attachment.fileName),
        'Cache-Control': 'public, max-age=300',
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    console.error('Error serving public document attachment:', error);
    return NextResponse.json({ error: 'Failed to serve attachment' }, { status: 500 });
  }
}
