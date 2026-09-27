import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@/config/brand';
import { Kicker, Shell, primaryCtaClass, secondaryCtaClass } from './primitives';

export function FinalCta() {
  const t = useTranslations('publicPages.landing.finalCta');

  return (
    <section className="border-t border-[var(--landing-border)] bg-[var(--landing-bg-elevated)]">
      <Shell className="py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16">
          <div className="max-w-3xl">
            <Kicker label={t('kicker')} accentVar="var(--landing-accent-emerald)" />
            <h2 className="landing-display mt-6 text-balance text-[36px] text-[var(--landing-text-dark)] sm:text-[48px] lg:text-[56px]">
              {t.rich('title', {
                accent: (chunks) => (
                  <span className="text-[var(--landing-accent-ruby)]">{chunks}</span>
                ),
              })}
            </h2>
            <p className="landing-body mt-5 max-w-xl text-[15px] text-[var(--landing-text-subtle)]">
              {t('description')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <Link href={ROUTES.signIn} className={primaryCtaClass}>
              {t('signIn')}
              <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Link>
            <Link href={ROUTES.trust} className={secondaryCtaClass}>
              {t('readTrustCentre')}
            </Link>
          </div>
        </div>

        <p className="landing-body mt-8 max-w-3xl text-[13px] text-[var(--landing-text-muted)]">
          {t('meta')}
        </p>
      </Shell>
    </section>
  );
}
