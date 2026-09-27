import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ValidTeamLogo } from '@/components/branding/validteam-logo';

/**
 * Layout for public-facing pages (no auth required). Keeps the document
 * chrome minimal — no sidebars, no command palette, no AI provider.
 *
 * Routes that mount here must also be allow-listed in middleware.ts.
 */

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const tLanding = useTranslations('publicPages.landing.nav');
  const tPublic = useTranslations('publicPages');
  const tAi = useTranslations('aiModelCards');

  return (
    <div className="bg-surface text-foreground min-h-screen">
      <header className="border-border bg-background/95 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="border-border mx-auto grid h-16 w-full max-w-[1200px] grid-cols-[minmax(0,1fr)_auto] items-stretch border-x px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label={tLanding('homeAria')}
            className="focus-visible:ring-ring inline-flex min-w-0 items-center gap-2 rounded-sm text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 lg:border-e lg:pe-6"
          >
            <ValidTeamLogo compact className="text-primary h-6 w-6" />
          </Link>

          <nav aria-label={tLanding('primaryAria')} className="flex items-center lg:ps-6">
            <ul className="text-muted-foreground flex items-center gap-1 text-xs">
              <li>
                <Link
                  href="/trust"
                  className="hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center rounded-md px-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
                >
                  {tPublic('trustEyebrow')}
                </Link>
              </li>
              <li>
                <Link
                  href="/ai-model-cards"
                  className="hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center rounded-md px-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
                >
                  {tAi('title')}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
