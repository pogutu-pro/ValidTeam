import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { productName, ROUTES } from '@/config/brand';
import { ValidTeamLogo } from '@/components/branding/validteam-logo';
import { MobileMenu } from './mobile-menu';
import { Shell, focusRingClass } from './primitives';

const navItems = [
  { labelKey: 'capabilities', href: '#capabilities' },
  { labelKey: 'howItWorks', href: '#how-it-works' },
  { labelKey: 'ai', href: '#ai' },
  { labelKey: 'trust', href: ROUTES.trust },
  { labelKey: 'faq', href: '#faq' },
] as const;

export function MarketingNav() {
  const t = useTranslations('publicPages.landing.nav');
  const items = navItems.map((item) => ({ ...item, label: t(`items.${item.labelKey}`) }));

  return (
    <nav
      aria-label={t('primaryAria')}
      className="sticky top-0 z-50 border-b border-[var(--landing-border)] bg-[color-mix(in_srgb,var(--landing-bg)_88%,transparent)] backdrop-blur-xl backdrop-saturate-150"
    >
      <Shell className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-stretch gap-0 lg:grid-cols-[minmax(14rem,1fr)_auto_minmax(14rem,1fr)]">
        <Link
          href="/"
          className={`flex min-w-0 items-center gap-2.5 rounded-sm lg:border-e lg:border-[var(--landing-border)] lg:pe-6 ${focusRingClass}`}
          aria-label={t('homeAria')}
        >
          <ValidTeamLogo
            compact
            variant="mono"
            className="shrink-0 text-[var(--landing-accent-ruby)]"
          />
          <span className="landing-title text-[15px] text-[var(--landing-text-dark)]">
            {productName}
          </span>
        </Link>

        <div className="hidden items-center gap-1 px-5 lg:flex">
          {items.map((item) =>
            item.href.startsWith('/') ? (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-[13px] text-[var(--landing-text-subtle)] transition-colors duration-150 hover:bg-[var(--landing-bg-elevated)] hover:text-[var(--landing-text-dark)] ${focusRingClass}`}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-[13px] text-[var(--landing-text-subtle)] transition-colors duration-150 hover:bg-[var(--landing-bg-elevated)] hover:text-[var(--landing-text-dark)] ${focusRingClass}`}
              >
                {item.label}
              </a>
            )
          )}
        </div>

        <div className="flex items-center justify-end gap-2 lg:border-s lg:border-[var(--landing-border)] lg:ps-6">
          <Link
            href={ROUTES.signIn}
            className={`hidden h-[34px] items-center rounded-md px-3 text-[13px] font-[430] text-[var(--landing-text-subtle)] transition-colors duration-150 hover:text-[var(--landing-text-dark)] md:inline-flex ${focusRingClass}`}
          >
            {t('signIn')}
          </Link>
          <Link
            href={ROUTES.aiTransparency}
            className={`hidden h-[34px] items-center gap-2 rounded-md border border-[var(--landing-border-strong)] px-3 text-[13px] font-[430] text-[var(--landing-text)] transition-colors duration-150 hover:bg-[var(--landing-bg-elevated)] min-[390px]:inline-flex ${focusRingClass}`}
          >
            <span className="hidden sm:inline">{t('aiTransparency')}</span>
            <span className="sm:hidden">{t('aiTransparencyShort')}</span>
          </Link>
          <Link
            href={ROUTES.signIn}
            className={`group inline-flex h-[34px] items-center gap-1.5 rounded-md bg-[var(--landing-accent-ruby-solid)] px-3 text-[13px] font-[450] text-white transition-colors duration-150 hover:bg-[var(--landing-accent-ruby-solid-hover)] ${focusRingClass}`}
          >
            {t('requestAccess')}
            <ArrowRight
              className="ease-snap h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
          <MobileMenu items={items} />
        </div>
      </Shell>
    </nav>
  );
}
