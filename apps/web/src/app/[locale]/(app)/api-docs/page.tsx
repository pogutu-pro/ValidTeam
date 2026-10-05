/**
 * Swagger UI for the ValidTeam HTTP API.
 *
 * Auth-gated to workspace admins:
 *   - super admins (`users.isSuperAdmin = true`), or
 *   - any user with role `owner` or `admin` in at least one organization.
 *
 * Anyone else is redirected to /dashboard. Unauthenticated users hit the
 * sign-in flow via the `(app)` segment's auth wiring.
 */

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { db, users } from '@validteam/db';
import { eq } from 'drizzle-orm';
import { ApiDocsClient } from './api-docs-client';
import { PageHeader } from '@/components/ui/page-header';
import { listActiveOrganizationMemberships } from '@/lib/auth/access-control';

export const dynamic = 'force-dynamic';

async function isWorkspaceAdmin(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ isSuperAdmin: users.isSuperAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.status !== 'active') return false;
  if (user.isSuperAdmin) return true;

  const memberships = await listActiveOrganizationMemberships(userId);
  return memberships.some((membership) => ['owner', 'admin'].includes(membership.role));
}

export default async function ApiDocsPage() {
  const t = await getTranslations('pagesWork');
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin');
  }

  const allowed = await isWorkspaceAdmin(session.user.id);
  if (!allowed) {
    redirect('/dashboard');
  }

  return (
    <div className="bg-background min-h-full">
      <div className="border-border bg-card border-b px-4 py-4 sm:px-5 lg:px-6">
        <div className="mx-auto w-full max-w-[1480px]">
          <PageHeader
            className="border-b-0 pb-0"
            title={t('apiDocs.title')}
            description={t.rich('apiDocs.description', {
              link: (chunks) => (
                <a
                  href="/openapi.json"
                  className="focus-visible:ring-ring rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {chunks}
                </a>
              ),
            })}
          />
        </div>
      </div>
      <ApiDocsClient specUrl="/openapi.json" />
    </div>
  );
}
