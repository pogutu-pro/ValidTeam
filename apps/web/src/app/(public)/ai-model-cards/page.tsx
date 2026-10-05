/**
 * /ai-model-cards — public, unauthenticated AI Model Cards page.
 *
 * Public product-transparency page. Each card describes
 * an AI feature ValidTeam deploys to end-users: purpose, model identity,
 * data sent, retention, and human-oversight default.
 *
 * Sourced from apps/web/src/config/ai-model-cards.ts so the same content
 * powers the in-app Transparency settings page and the first-time
 * disclosure modal.
 */

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AI_FEATURE_MODEL_CARDS, DISCLOSURE_VERSION } from '@/config/ai-model-cards';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('aiModelCards.meta');

  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function AiModelCardsPage() {
  const t = await getTranslations('aiModelCards');

  return (
    <main className="border-border bg-background mx-auto min-h-[calc(100dvh-4rem)] max-w-[1200px] border-x px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <header className="border-border grid gap-8 border-b pb-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:pb-14">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em]">
            {t('disclosureBadge')}
          </p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
        </div>
        <div className="self-end">
          <p className="text-muted-foreground max-w-2xl text-sm leading-7">
            {t.rich('intro', {
              version: () => (
                <code className="text-foreground font-mono">{DISCLOSURE_VERSION}</code>
              ),
            })}
          </p>
          <p className="text-muted-foreground mt-3 text-xs">{t('lastReviewed')}</p>
        </div>
      </header>

      <div className="grid gap-10 py-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:py-12">
        <nav aria-label={t('onThisPage')} className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-[0.14em]">
            {t('onThisPage')}
          </p>
          <ul className="border-border grid grid-cols-1 border-t text-sm sm:grid-cols-2 lg:grid-cols-1">
            {AI_FEATURE_MODEL_CARDS.map((card) => (
              <li key={card.id} className="border-border border-b">
                <a
                  href={`#${card.id}`}
                  className="hover:text-foreground focus-visible:ring-ring text-muted-foreground block rounded-sm py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2"
                >
                  {t(`features.${card.id}.name`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-border divide-border min-w-0 divide-y border-t">
          {AI_FEATURE_MODEL_CARDS.map((card, index) => (
            <section
              key={card.id}
              id={card.id}
              className="grid scroll-mt-32 gap-5 py-10 sm:grid-cols-[2rem_minmax(0,1fr)] lg:py-12"
              data-testid={`model-card-${card.id}`}
            >
              <span className="text-muted-foreground font-mono text-xs" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>

              <div className="min-w-0">
                <header>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {t(`features.${card.id}.name`)}
                  </h2>
                  <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                    {t(`features.${card.id}.purpose`)}
                  </p>
                </header>

                <dl className="border-border divide-border my-6 grid border-y text-xs sm:grid-cols-3 sm:divide-x">
                  <div className="py-3 sm:px-4 sm:first:ps-0">
                    <dt className="text-muted-foreground mb-1 uppercase tracking-wider">
                      {t('model')}
                    </dt>
                    <dd className="font-mono">{card.defaultModel}</dd>
                  </div>
                  <div className="border-border border-t py-3 sm:border-t-0 sm:px-4">
                    <dt className="text-muted-foreground mb-1 uppercase tracking-wider">
                      {t('provider')}
                    </dt>
                    <dd className="font-mono">{card.defaultProvider}</dd>
                  </div>
                  <div className="border-border border-t py-3 sm:border-t-0 sm:px-4 sm:last:pe-0">
                    <dt className="text-muted-foreground mb-1 uppercase tracking-wider">
                      {t('oversightDefault')}
                    </dt>
                    <dd>
                      {card.defaultOversight === 'review_required'
                        ? t('reviewRequired')
                        : t('autoApplyAllowed')}
                    </dd>
                  </div>
                </dl>

                <div className="grid gap-5 text-sm sm:grid-cols-2">
                  <div>
                    <h3 className="text-foreground font-medium">{t('dataSent')}</h3>
                    <p className="text-muted-foreground mt-1 leading-6">
                      {t(`features.${card.id}.dataSent`)}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-foreground font-medium">{t('retention')}</h3>
                    <p className="text-muted-foreground mt-1 leading-6">
                      {t(`features.${card.id}.retention`)}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>

      <footer className="border-border text-muted-foreground border-t pt-6 text-xs">
        <p>
          {t.rich('footerContact', {
            link: () => (
              <a href="mailto:privacy@rumiamanage.com" className="underline">
                {'privacy@rumiamanage.com'}
              </a>
            ),
          })}
        </p>
      </footer>
    </main>
  );
}
