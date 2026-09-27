import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { type GranularPermissions, type ProjectRole } from '@tasknebula/db';
import { resolveProjectCapabilityAccess } from '@/lib/auth/project-access';

// Full permissions interface with all granular permissions
export interface UserProjectPermissions extends GranularPermissions {
  isMember: boolean;
  role: ProjectRole | null;
  isSuperAdmin: boolean;
  isOrgOwner: boolean;
  isOrgAdmin: boolean;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId: projectIdOrKey } = await params;
    const access = await resolveProjectCapabilityAccess(session.user.id, projectIdOrKey);
    if (!access.project || !access.canRead) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const elevated = access.isSuperAdmin || access.isOrgOwner || access.isOrgAdmin;
    const permissions: UserProjectPermissions = {
      isMember: true,
      role: access.role ?? (elevated ? 'product_owner' : null),
      isSuperAdmin: access.isSuperAdmin,
      isOrgOwner: access.isOrgOwner,
      isOrgAdmin: access.isOrgAdmin || access.isOrgOwner,
      ...access.permissions,
    };

    return NextResponse.json(permissions);
  } catch (error) {
    console.error('Error fetching project permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}
