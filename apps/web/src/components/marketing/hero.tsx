import Link from 'next/link';
import { ArrowRight, Users, FolderKanban, Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PATHS, ROUTES } from '@/config/brand';
import { Kicker, Shell, focusRingClass, primaryCtaClass, secondaryCtaClass } from './primitives';

/**
 * Hero — the promise plus the three things the team actually gets. The side rail
 * lists the operating surfaces (people, projects, visibility) instead of proof
 * links, because ValidTeam sells accountable team state, not credentials.
 */
const capabilityKeys = ['people', 'projects', 'visibility'] as const;

const capabilityIcons = {
  people: Users,
  projects: FolderKanban,
  visibility: Radar,
} as const;

export function Hero() {
  const t = useTranslations('publicPages.landing.hero');
  const rail = useTranslations('publicPages.landing.hero.capabilities');

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="relative border-b border-[var(--landing-border)]"
    >
      <Shell className="flex py-14 sm:py-20 lg:min-h-[calc(100svh-4rem)] lg:items-center lg:py-24">
        <div className="grid w-full gap-14 lg:grid-cols-12 lg:items-end lg:gap-10">
          <div className="animate-fade-up lg:col-span-8 xl:col-span-9">
            <Kicker label={t('kicker')} accentVar="var(--landing-accent-ruby)" />
            <h1
              id="landing-hero-title"
              className="landing-display mt-7 max-w-5xl text-balance text-[40px] text-[var(--landing-text-dark)] min-[390px]:text-[46px] sm:text-[62px] lg:text-[72px] xl:text-[82px]"
            >
              {t.rich('title', {
                accent: (chunks) => (
                  <span className="text-[var(--landing-accent-ruby)]">{chunks}</span>
                ),
              })}
            </h1>
            <p className="landing-body mt-6 max-w-2xl text-[15px] text-[var(--landing-text-subtle)] sm:text-[18px]">
              {t('description')}
            </p>

            <div className="mt-8 flex flex-col items-stretch gap-3 min-[390px]:flex-row min-[390px]:items-center">
              <Link
                href={PATHS.signUp}
                className={`${primaryCtaClass} justify-between min-[390px]:justify-center`}
              >
                {t('openProduct')}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
              <Link
                href={ROUTES.trust}
                className={`${secondaryCtaClass} justify-between min-[390px]:justify-center`}
              >
                {t('readTrustCentre')}
              </Link>
            </div>

            <ul className="mt-10 flex flex-wrap gap-2">
              {capabilityKeys.map((key) => (
                <li
                  key={key}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--landing-border-strong)] bg-[var(--landing-bg-elevated)] px-3 py-1.5 text-[12px] text-[var(--landing-text-body)]"
                >
                  {t(`chips.${key}`)}
                </li>
              ))}
            </ul>
          </div>

          <aside
            aria-label={rail('aria')}
            className="border-y border-[var(--landing-border-strong)] bg-[var(--landing-bg-surface)] px-4 py-6 lg:col-span-4 lg:border-y-0 lg:border-s lg:bg-transparent lg:px-0 lg:pb-1 lg:ps-8 lg:pt-0 xl:col-span-3"
          >
            <p className="max-w-sm text-[13px] font-[500] leading-5 text-[var(--landing-text-dark)]">
              {rail('headline')}
            </p>
            <p className="mt-1 max-w-sm text-[12px] leading-5 text-[var(--landing-text-subtle)]">
              {rail('subline')}
            </p>

            <ul className="mt-6 border-t border-[var(--landing-border)]">
              {capabilityKeys.map((key) => {
                const Icon = capabilityIcons[key];
                return (
                  <li
                    key={key}
                    className="flex gap-3 border-b border-[var(--landing-border)] py-3.5"
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--landing-accent-ruby)] text-white"
                      aria-hidden="true"
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-[500] leading-5 text-[var(--landing-text-dark)]">
                        {rail(`${key}.title`)}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-[var(--landing-text-subtle)]">
                        {rail(`${key}.body`)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 border-s border-[var(--landing-border-strong)] ps-3 text-[11px] leading-5 text-[var(--landing-text-subtle)]">
              {rail('footer')}
            </p>
          </aside>
        </div>
      </Shell>
    </section>
  );
}
