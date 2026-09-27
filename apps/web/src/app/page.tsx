import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { HeroShowcase } from '@/components/landing/product-showcase';
import { AiMcpSection } from '@/components/marketing/ai-mcp-section';
import { Faq } from '@/components/marketing/faq';
import { FeatureGrid } from '@/components/marketing/feature-grid';
import { FinalCta } from '@/components/marketing/final-cta';
import { Hero } from '@/components/marketing/hero';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { WorkflowNarrative } from '@/components/marketing/workflow-narrative';
import { PRODUCT_SUMMARY, absoluteUrl, productName, resolveMetadataBase } from '@/config/brand';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('publicPages.landing.meta');
  const title = t('title');
  const description = t('description');

  return {
    metadataBase: resolveMetadataBase(),
    title,
    description,
    keywords: [
      'team operations software',
      'team management platform',
      'project and task management',
      'goals and OKR tracking',
      'organizational visibility',
      'AI-assisted productivity',
    ],
    openGraph: {
      type: 'website',
      url: '/',
      siteName: productName,
      title,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

/**
 * Landing page. Thin composition: every section lives in src/components/marketing/,
 * with a small client island only for clipboard behavior.
 */
export default async function HomePage() {
  const t = await getTranslations('publicPages.landing.meta');
  const softwareApplicationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: productName,
    description: t('description') || PRODUCT_SUMMARY,
    url: absoluteUrl('/').toString(),
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Team Operations',
  } as const;

  return (
    <div className="landing-dark relative isolate min-h-screen overflow-x-hidden bg-[var(--landing-bg)] text-[var(--landing-text)] antialiased">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-[var(--landing-bg-elevated)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--landing-text-dark)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--landing-accent-ruby)]"
      >
        {t('skipToContent')}
      </a>

      <MarketingNav />

      <main id="main-content" className="relative">
        <Hero />
        <HeroShowcase />
        <FeatureGrid />
        <WorkflowNarrative />
        <AiMcpSection />
        <Faq />
        <FinalCta />
      </main>

      <MarketingFooter />

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
    </div>
  );
}
