import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DocumentContentViewer } from '@/components/docs/document-content-viewer';
import { getPublicDocumentByToken } from '@/lib/docs/server';
import { ExternalLink, Globe2, LockKeyhole } from 'lucide-react';
import { productName } from '@/config/brand';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const t = await getTranslations('publicPages');
  const page = await getPublicDocumentByToken(token);

  if (!page) {
    return {
      title: t('shareMetaFallbackTitle'),
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  return {
    title: t('shareMetaTitle', { title: page.title }),
    description: page.excerpt || t('shareMetaDescription'),
    robots: page.allowSearchIndexing
      ? {
          index: true,
          follow: true,
        }
      : {
          index: false,
          follow: false,
        },
  };
}

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations('publicPages');
  const formatter = await getFormatter();
  const page = await getPublicDocumentByToken(token);

  if (!page) {
    notFound();
  }

  return (
    <main className="bg-surface min-h-dvh overflow-x-hidden">
      <article className="border-border bg-background animate-blur-in mx-auto min-h-dvh max-w-[1200px] border-x">
        <header className="border-border grid gap-8 border-b px-4 py-10 sm:px-8 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:px-10 lg:py-14">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip flex items-center gap-1.5">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('sharePublic')}
              </span>
              {!page.allowSearchIndexing && (
                <span className="chip flex items-center gap-1.5">
                  <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('shareSearchHidden')}
                </span>
              )}
            </div>

            <p className="text-muted-foreground font-mono text-xs tabular-nums">
              {t('shareUpdated', {
                date: formatter.dateTime(new Date(page.updatedAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </p>
          </div>

          <div className="min-w-0 space-y-4">
            <h1 className="text-foreground text-balance break-words text-3xl font-semibold tracking-tight sm:text-4xl">
              {page.title}
            </h1>

            {page.excerpt && (
              <p className="text-muted-foreground text-base leading-7">{page.excerpt}</p>
            )}
          </div>
        </header>

        <div className="grid lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="min-w-0 px-4 py-10 sm:px-8 lg:col-start-2 lg:row-start-1 lg:px-10 lg:py-12">
            <section className="mx-auto max-w-3xl">
              <DocumentContentViewer content={page.contentJson} />
            </section>

            {page.attachments.length > 0 && (
              <section className="border-border mx-auto mt-10 max-w-3xl space-y-3 border-t pt-8">
                <h2 className="text-foreground text-sm font-medium">{t('sharePublishedFiles')}</h2>
                <ul className="border-border divide-border divide-y border-y">
                  {page.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <a
                        href={attachment.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:bg-accent focus-visible:ring-ring block rounded-sm px-3 py-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      >
                        <div className="text-foreground break-all font-medium">
                          {attachment.fileName}
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-xs">
                          {attachment.mimeType}
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="border-border border-t px-4 py-8 sm:px-8 lg:col-start-1 lg:row-start-1 lg:border-e lg:border-t-0 lg:px-6 lg:py-10">
            <footer className="flex flex-col gap-4 lg:sticky lg:top-8">
              <p className="text-muted-foreground text-xs leading-5">
                {t('sharePublicViewNotice')}
              </p>
              <Button asChild variant="outline" size="sm" className="w-full rounded-md">
                <Link href="/">
                  {productName}
                  <ExternalLink className="ms-1.5 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </footer>
          </aside>
        </div>
      </article>
    </main>
  );
}
