import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ValidTeamLogo } from '@/components/branding/validteam-logo';
import { productName, companyName, ROUTES } from '@/config/brand';
import { Shell, focusRingClass } from './primitives';

type FooterLink = { labelKey: string; href: string; internal?: boolean };

const columns: Array<{ titleKey: string; links: FooterLink[] }> = [
  {
    titleKey: 'product',
    links: [
      { labelKey: 'capabilities', href: '#capabilities' },
      { labelKey: 'howItWorks', href: '#how-it-works' },
      { labelKey: 'ai', href: '#ai' },
      { labelKey: 'faq', href: '#faq' },
    ],
  },
  {
    titleKey: 'trust',
    links: [
      { labelKey: 'trustCentre', href: ROUTES.trust, internal: true },
      { labelKey: 'aiTransparency', href: ROUTES.aiTransparency, internal: true },
      { labelKey: 'documents', href: ROUTES.documents, internal: true },
      { labelKey: 'status', href: ROUTES.status, internal: true },
    ],
  },
  {
    titleKey: 'workspace',
    links: [
      { labelKey: 'signIn', href: ROUTES.signIn, internal: true },
      { labelKey: 'dashboard', href: '/dashboard', internal: true },
      { labelKey: 'myWork', href: '/my-issues', internal: true },
      { labelKey: 'contact', href: ROUTES.contact, internal: true },
    ],
  },
];

export function MarketingFooter() {
  const t = useTranslations('publicPages.landing.footer');

  return (
    <footer className="border-t border-[var(--landing-border)]">
      <Shell className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] lg:gap-0">
          <div className="max-w-sm sm:col-span-2 lg:col-span-1 lg:pe-10">
            <div className="flex items-center gap-3">
              <ValidTeamLogo variant="mono" className="text-[var(--landing-accent-ruby)]" />
              <div>
                <p className="landing-title text-[15px] text-[var(--landing-text-dark)]">
                  {productName}
                </p>
                <p className="text-[11px] text-[var(--landing-text-subtle)]">{t('tagline')}</p>
              </div>
            </div>
            <p className="mt-5 text-[12px] leading-5 text-[var(--landing-text-subtle)]">
              {t('description')}
            </p>
            <Link
              href={ROUTES.signIn}
              className={`mt-5 inline-flex h-[34px] items-center gap-2 rounded-md border border-[var(--landing-border-strong)] px-3 text-[12px] font-[430] text-[var(--landing-text)] transition-colors duration-150 hover:bg-[var(--landing-bg-elevated)] ${focusRingClass}`}
            >
              {t('links.signIn')}
            </Link>
          </div>

          {columns.map((column) => (
            <div
              key={column.titleKey}
              className="lg:border-s lg:border-[var(--landing-border)] lg:px-8 lg:last:pe-0"
            >
              <h3 className="landing-kicker text-[var(--landing-text-subtle)]">
                {t(`columns.${column.titleKey}`)}
              </h3>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.labelKey}>
                    <Link
                      href={link.href}
                      className={`rounded-sm text-[13px] text-[var(--landing-text-subtle)] transition-colors duration-150 hover:text-[var(--landing-text-dark)] ${focusRingClass}`}
                    >
                      {t(`links.${link.labelKey}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--landing-border)] pt-6 text-[12px] text-[var(--landing-text-subtle)]">
          <span>{t('copyright', { year: new Date().getFullYear(), company: companyName })}</span>
          <span>{t('trademarks')}</span>
        </div>
      </Shell>
    </footer>
  );
}
