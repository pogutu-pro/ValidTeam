import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { productName, ROUTES } from '@/config/brand';

interface AuthShellProps {
  children: ReactNode;
  contentClassName?: string;
}

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || productName;
const BRAND_INITIALS =
  APP_NAME.match(/\b[\p{L}\p{N}]/gu)
    ?.join('')
    .slice(0, 2)
    .toUpperCase() || 'TN';

export function AuthShell({ children, contentClassName }: AuthShellProps) {
  const t = useTranslations('publicPages.authShell');

  return (
    <main className="bg-surface text-foreground relative min-h-dvh overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh max-w-[1440px] items-stretch justify-center md:p-4 lg:p-6">
        <section className="border-border bg-background grid min-h-dvh w-full overflow-hidden border-x md:min-h-[min(820px,calc(100dvh-2rem))] md:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] md:rounded-lg md:border lg:min-h-[min(820px,calc(100dvh-3rem))]">
          <aside className="border-border bg-rail text-rail-foreground hidden min-h-full flex-col border-e md:flex">
            <div className="border-b border-white/10 p-8 lg:p-10">
              <BrandLink inverse />
            </div>

            <div className="mt-auto p-8 lg:p-10">
              <div className="border-t border-white/15 pt-6">
                <p className="max-w-md text-2xl font-semibold leading-tight tracking-tight text-white">
                  {t('headline')}
                </p>
                <p className="text-rail-foreground mt-3 max-w-sm text-sm leading-6">
                  {t('subline')}
                </p>
              </div>

              <ol className="mt-8 border-y border-white/15 text-sm">
                <li>
                  <a
                    href={ROUTES.trust}
                    className="focus-visible:ring-primary focus-visible:ring-offset-rail text-rail-foreground flex min-h-11 items-center border-b border-white/10 py-2 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <span>{t('items.trustCentre')}</span>
                  </a>
                </li>
                <li>
                  <a
                    href={ROUTES.aiTransparency}
                    className="focus-visible:ring-primary focus-visible:ring-offset-rail text-rail-foreground flex min-h-11 items-center border-b border-white/10 py-2 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <span>{t('items.aiTransparency')}</span>
                  </a>
                </li>
                <li>
                  <a
                    href={ROUTES.status}
                    className="focus-visible:ring-primary focus-visible:ring-offset-rail text-rail-foreground flex min-h-11 items-center border-b border-white/10 py-2 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <span>{t('items.status')}</span>
                  </a>
                </li>
                <li>
                  <a
                    href="/openapi.json"
                    className="focus-visible:ring-primary focus-visible:ring-offset-rail text-rail-foreground flex min-h-11 items-center py-2 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <span>{t('items.openapiSpec')}</span>
                  </a>
                </li>
              </ol>
            </div>
          </aside>

          <div
            className={cn(
              'bg-background relative flex min-h-dvh flex-col justify-start overflow-y-auto px-5 pb-8 pt-6 sm:min-h-0 sm:justify-center sm:px-10 sm:py-10 md:px-12 lg:px-16 xl:px-24',
              contentClassName
            )}
          >
            <div className="border-border mb-10 border-b pb-5 md:hidden">
              <BrandLink />
            </div>
            <div className="relative w-full max-w-[400px] self-center">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}

function BrandLink({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link
      href="/"
      className={cn(
        'inline-flex min-h-11 max-w-full items-center gap-3 rounded-sm text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        inverse
          ? 'text-rail-foreground focus-visible:ring-primary focus-visible:ring-offset-rail hover:text-white'
          : 'text-foreground hover:text-primary focus-visible:ring-ring focus-visible:ring-offset-background'
      )}
      aria-label={APP_NAME}
    >
      <span
        className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
        aria-hidden="true"
      >
        {BRAND_INITIALS}
      </span>
      <span className="truncate">{APP_NAME}</span>
    </Link>
  );
}
