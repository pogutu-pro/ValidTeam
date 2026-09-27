import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, users, eq } from '@tasknebula/db';
import { listActiveOrganizationMemberships } from '@/lib/auth/access-control';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user super admin status
    const [user] = await db
      .select({
        isSuperAdmin: users.isSuperAdmin,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    // Get first active organization membership (for now, users belong to one org)
    const [orgMember] = await listActiveOrganizationMemberships(session.user.id);

    return NextResponse.json({
      isSuperAdmin: user?.isSuperAdmin || false,
      orgRole: orgMember?.role || null,
      organizationId: orgMember?.organizationId || null,
    });
  } catch (error) {
    console.error('Error fetching user role:', error);
    return NextResponse.json({ error: 'Failed to fetch user role' }, { status: 500 });
  }
}
