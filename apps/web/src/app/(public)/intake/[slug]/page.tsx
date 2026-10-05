import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { db, intakeForms } from '@validteam/db';
import { eq } from 'drizzle-orm';
import type { IntakeFieldDefinition } from '@validteam/db';
import { PublicIntakeForm } from '@/components/intake/public-intake-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('publicPages.intake');
  const [form] = await db
    .select({ title: intakeForms.title, description: intakeForms.description })
    .from(intakeForms)
    .where(eq(intakeForms.slug, slug))
    .limit(1);

  if (!form) {
    return { title: t('submitMetaTitle'), robots: { index: false, follow: false } };
  }
  return {
    title: form.title,
    description: form.description ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicIntakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.slug, slug)).limit(1);

  if (!form || !form.isPublic) {
    notFound();
  }

  const fields = (form.fields as IntakeFieldDefinition[]) ?? [];

  return (
    <main className="bg-surface min-h-[calc(100dvh-4rem)]">
      <div className="border-border bg-background mx-auto min-h-[calc(100dvh-4rem)] max-w-[1000px] border-x px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
          <header className="border-border space-y-3 border-b pb-8 lg:border-b-0 lg:border-e lg:pe-10">
            <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
              {form.title}
            </h1>
            {form.description ? (
              <p className="text-muted-foreground text-base leading-7">{form.description}</p>
            ) : null}
          </header>

          <div className="min-w-0 lg:ps-2">
            <PublicIntakeForm
              slug={form.slug}
              fields={fields}
              requiresCaptcha={form.requiresCaptcha}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
