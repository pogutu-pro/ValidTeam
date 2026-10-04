/**
 * Shared renderer for the public legal documents (Privacy Policy, Terms).
 *
 * Public (no auth) — Google OAuth verification requires both to be reachable
 * without a session. Mounted in the (public) group and allow-listed in
 * middleware.ts.
 *
 * Content comes from `apps/web/src/config/legal.ts`; the surrounding chrome is
 * translated via `publicPages.legal*`.
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  LEGAL_CONTACT,
  LEGAL_LAST_REVIEWED,
  LEGAL_INTRO,
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
} from '@/config/legal';

export async function LegalDocument({ doc }: { doc: 'privacy' | 'terms' }) {
  const t = await getTranslations('publicPages');
  const sections = doc === 'privacy' ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <main className="border-border bg-background mx-auto w-full max-w-[1200px] border-x px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
      <header className="border-border grid gap-6 border-b pb-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.14em]">
            {t('legalEyebrow')}
          </p>
          <p className="text-muted-foreground mt-3 text-xs">
            {t('legalLastReviewed', { date: LEGAL_LAST_REVIEWED })}
          </p>
        </div>

        <div className="grid gap-5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {doc === 'privacy' ? t('legalPrivacyTitle') : t('legalTermsTitle')}
          </h1>

          {LEGAL_INTRO[doc].map((paragraph) => (
            <p
              key={paragraph.slice(0, 40)}
              className="text-muted-foreground text-sm leading-relaxed"
            >
              {paragraph}
            </p>
          ))}

          <nav className="flex flex-wrap gap-4 pt-1 text-sm">
            <Link
              href="/legal/privacy"
              className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2"
            >
              {t('legalPrivacyTitle')}
            </Link>
            <Link
              href="/legal/terms"
              className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2"
            >
              {t('legalTermsTitle')}
            </Link>
            <Link
              href="/trust"
              className="hover:text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2"
            >
              {t('trustEyebrow')}
            </Link>
          </nav>
        </div>
      </header>

      <div className="grid gap-10 pt-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label={t('legalOnThisPage')} className="text-muted-foreground hidden lg:block">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em]">
            {t('legalOnThisPage')}
          </p>
          <ol className="grid gap-2 text-xs">
            {sections.map((section, index) => (
              <li key={section.heading}>
                <a
                  href={`#section-${index + 1}`}
                  className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-10">
          {sections.map((section, index) => (
            <section key={section.heading} id={`section-${index + 1}`} className="grid gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>

              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="text-muted-foreground text-sm leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}

              {section.bullets ? (
                <ul className="text-muted-foreground grid gap-2 text-sm leading-relaxed">
                  {section.bullets.map((bullet) => (
                    <li key={bullet.slice(0, 40)} className="flex gap-2">
                      <span aria-hidden="true" className="text-muted-foreground/60 select-none">
                        &middot;
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <footer className="border-border text-muted-foreground grid gap-2 border-t pt-6 text-xs">
            <p>
              {doc === 'privacy'
                ? t('legalPrivacyContact', { email: LEGAL_CONTACT.privacy })
                : t('legalTermsContact', { email: LEGAL_CONTACT.legal })}
            </p>
            <p>{t('legalLastReviewed', { date: LEGAL_LAST_REVIEWED })}</p>
          </footer>
        </div>
      </div>
    </main>
  );
}
