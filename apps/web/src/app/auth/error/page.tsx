'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthIntro, AuthLoading } from '@/components/auth/auth-ui';
import Link from 'next/link';

const ERROR_KEYS = ['Configuration', 'AccessDenied', 'Verification', 'Default'] as const;

function ErrorContent() {
  const t = useTranslations('authPages');
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || 'Default';
  const errorKey = (ERROR_KEYS as readonly string[]).includes(error) ? error : 'Default';
  const errorMessage = t(`error.messages.${errorKey}`);

  return (
    <div className="animate-fade-up space-y-7">
      <AuthIntro title={t('error.title')} description={errorMessage} />

      <Button asChild className="w-full text-sm" size="xl">
        <Link href="/auth/signin">{t('error.tryAgain')}</Link>
      </Button>
    </div>
  );
}

export default function AuthErrorPage() {
  const tCommon = useTranslations('common');
  return (
    <AuthShell>
      <Suspense fallback={<AuthLoading label={tCommon('loading')} />}>
        <ErrorContent />
      </Suspense>
    </AuthShell>
  );
}
