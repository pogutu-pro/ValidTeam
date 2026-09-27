'use client';

import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function OfflinePage() {
  const t = useTranslations('publicPages');
  const tAuth = useTranslations('authExtra');
  const tNotFound = useTranslations('errorPages.notFound');

  return (
    <main className="bg-surface text-foreground grid min-h-dvh place-items-center px-4 py-8">
      <section
        aria-labelledby="offline-title"
        className="animate-fade-up border-border bg-background grid w-full max-w-3xl overflow-hidden rounded-lg border sm:grid-cols-[12rem_minmax(0,1fr)]"
      >
        <div className="bg-rail text-rail-foreground flex flex-col justify-between gap-8 p-6 sm:p-8">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 text-white"
            aria-hidden="true"
          >
            <WifiOff className="h-5 w-5" />
          </div>
          <p className="kicker text-rail-foreground">{tAuth('network_error')}</p>
        </div>

        <div className="p-6 sm:p-8">
          <div role="status" aria-live="polite">
            <h1 id="offline-title" className="text-balance text-2xl font-semibold tracking-tight">
              {t('offlineTitle')}
            </h1>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button onClick={() => window.location.reload()} size="xl" className="w-full text-sm">
              {t('offlineRetry')}
            </Button>
            <Button asChild size="xl" variant="outline" className="w-full text-sm">
              <Link href="/">{tNotFound('backToHome')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
