import { SignInForm } from '@/components/auth/signin-form';
import { AuthShell } from '@/components/auth/auth-shell';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

// signin form reads query params (verified=1, reset=1, error=...) via useSearchParams,
// which requires either a Suspense boundary or opting out of static prerender.
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  // `auth()` performs the durable user-status lookup. Middleware deliberately
  // leaves this route reachable for stale JWTs so deactivated accounts land on
  // a usable sign-in screen instead of entering a redirect loop.
  const session = await auth();
  if (session?.user?.id) {
    redirect('/dashboard');
  }

  return (
    <AuthShell>
      <SignInForm />
    </AuthShell>
  );
}
