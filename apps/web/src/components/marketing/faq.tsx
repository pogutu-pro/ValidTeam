import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@/config/brand';
import { SectionHeader, Shell } from './primitives';

/**
 * FAQ — native <details>/<summary> so it works with JavaScript disabled. The
 * localized strings also feed the FAQPage JSON-LD emitted below.
 */
const faqItemKeys = [
  'whatIsIt',
  'whoUses',
  'accountability',
  'aiKeys',
  'aiReality',
  'mcpServer',
  'imports',
  'dataVisibility',
] as const;

export function Faq() {
  const t = useTranslations('publicPages.landing.faq');
  const truth = useTranslations('publicPages.landing.productTruth');
  const importT = useTranslations('pagesSettings.import');
  const answerOverrides: Partial<Record<(typeof faqItemKeys)[number], string>> = {
    aiKeys: truth('aiKeys'),
    aiReality: truth('ai'),
    mcpServer: truth('mcp'),
    imports: importT('subtitle'),
    dataVisibility: truth('data'),
  };
  const faqItems = faqItemKeys.map((key) => ({
    key,
    question: t(`items.${key}.question`),
    answer: answerOverrides[key] ?? t(`items.${key}.answer`),
  }));

  return (
    <section id="faq" className="border-t border-[var(--landing-border)]">
      <Shell className="py-16 sm:py-20 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <SectionHeader
              kicker={t('kicker')}
              kickerAccentVar="var(--landing-accent-violet)"
              title={t('title')}
              description={t('description')}
              compact
            />
          </div>

          <div className="min-w-0">
            <div className="divide-y divide-[var(--landing-border)] border-y border-[var(--landing-border)]">
              {faqItems.map((item, index) => (
                <details key={item.key} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-sm py-4 text-[15px] font-[440] text-[var(--landing-text-dark)] transition-colors duration-150 hover:bg-[var(--landing-bg-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent-ruby)] [&::-webkit-details-marker]:hidden">
                    <span
                      className="font-mono text-[10px] tabular-nums text-[var(--landing-text-muted)]"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{item.question}</span>
                    <ChevronRight
                      className="ease-snap h-4 w-4 shrink-0 text-[var(--landing-text-muted)] transition-transform duration-150 group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="landing-body pb-5 ps-11 text-[14px] text-[var(--landing-text-subtle)]">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>

            <p className="landing-body mt-6 max-w-3xl text-[13px] text-[var(--landing-text-muted)]">
              {t.rich('statusPrompt', {
                link: (chunks) => (
                  <Link
                    href={ROUTES.contact}
                    className="rounded-sm text-[var(--landing-text-body)] underline decoration-[var(--landing-border-light)] underline-offset-2 transition-colors duration-150 hover:text-[var(--landing-text-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent-ruby)]"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      </Shell>

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqItems.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: { '@type': 'Answer', text: item.answer },
            })),
          }),
        }}
      />
    </section>
  );
}
