/**
 * Privacy Policy — public page.
 *
 * Google OAuth verification requires this to be reachable without a session.
 */

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument } from '../_components/legal-document';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('publicPages');
  return {
    title: t('legalPrivacyTitle'),
    description: t('legalPrivacyMetaDescription'),
  };
}

export default function PrivacyPolicyPage() {
  return <LegalDocument doc="privacy" />;
}
