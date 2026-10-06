import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { MeetExperience } from '@/components/meetings/room/meet-experience';

// Meeting links are private: never indexed, never sent as a Referer.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meetings');
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export const dynamic = 'force-dynamic';

export default async function MeetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <MeetExperience slug={slug} />
    </Suspense>
  );
}
