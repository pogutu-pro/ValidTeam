import { db, initiatives } from '@tasknebula/db';
import { eq } from 'drizzle-orm';
import { resolveOrganizationAccess } from '@/lib/auth/access-control';

export type InitiativeAccess = {
  initiative: typeof initiatives.$inferSelect | null;
  canRead: boolean;
};

export async function resolveInitiativeAccess(
  userId: string,
  initiativeId: string
): Promise<InitiativeAccess> {
  const [initiative] = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, initiativeId))
    .limit(1);

  if (!initiative) {
    return { initiative: null, canRead: false };
  }

  return {
    initiative,
    canRead: (await resolveOrganizationAccess(userId, initiative.workspaceId)).allowed,
  };
}
