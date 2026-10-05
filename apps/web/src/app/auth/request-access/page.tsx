import { AuthShell } from '@/components/auth/auth-shell';
import { getTranslations } from 'next-intl/server';

export default async function RequestAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('requestAccessPage');
  const params = await searchParams;
  const sent = params.sent === '1';
  const failed = params.error === '1';

  return (
    <AuthShell>
      <form
        action="/api/auth/request-access"
        method="POST"
        className="bg-card/60 text-card-foreground w-full max-w-md space-y-4 rounded-lg border p-8 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('intro')}</p>
        </div>

        {sent ? (
          <p className="text-sm text-green-600">{t('sent')}</p>
        ) : failed ? (
          <p className="text-sm text-red-600">{t('error')}</p>
        ) : null}

        <div className="grid gap-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t('name')}
          </label>
          <input
            id="name"
            name="name"
            required
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t('email')}
          </label>
          <input
            id="email"
            type="email"
            name="email"
            required
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="reason" className="text-sm font-medium">
            {t('reason')}
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            className="rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="bg-primary text-primary-foreground h-9 w-full rounded-md px-4 text-sm font-medium"
        >
          {t('submit')}
        </button>

        <p className="text-muted-foreground text-xs">{t('spamNotice')}</p>
      </form>
    </AuthShell>
  );
}
