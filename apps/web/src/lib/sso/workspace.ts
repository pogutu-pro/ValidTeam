/**
 * Workspace resolver — turn a `[workspace_slug]` URL parameter into the
 * loaded `sso_configs` row (plus the organization id). Returns null if the
 * slug doesn't exist or SSO is not enabled.
 */
import { db, organizations, ssoConfigs, and, eq, ne } from '@validteam/db';
import { revealSsoPrivateKey } from './private-key';

export type WorkspaceSso = {
  workspaceId: string;
  workspaceSlug: string;
  config: typeof ssoConfigs.$inferSelect;
};

export async function loadSsoForSlug(slug: string): Promise<WorkspaceSso | null> {
  if (!slug) return null;
  const [row] = await db
    .select({
      org: organizations,
      sso: ssoConfigs,
    })
    .from(organizations)
    .leftJoin(ssoConfigs, eq(ssoConfigs.workspaceId, organizations.id))
    .where(and(eq(organizations.slug, slug), ne(organizations.status, 'suspended')))
    .limit(1);
  if (!row || !row.sso) return null;
  return {
    workspaceId: row.org.id,
    workspaceSlug: row.org.slug,
    config: {
      ...row.sso,
      privateKey: revealSsoPrivateKey(row.sso.privateKey),
    },
  };
}
