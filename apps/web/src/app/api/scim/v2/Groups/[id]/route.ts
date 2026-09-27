/**
 * SCIM 2.0 single-Group endpoints.
 *   GET    /Groups/{id}   → Read
 *   PUT    /Groups/{id}   → Replace (Okta)
 *   PATCH  /Groups/{id}   → Modify  (Entra)
 *   DELETE /Groups/{id}   → Delete
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateScimRequest, scimTokenCan } from '@/lib/sso/tokens';
import type { ScimScope } from '@/lib/scim/scopes';
import { scimError, scimResponse } from '@/lib/scim/types';
import type { PatchRequest } from '@/lib/scim/types';
import {
  deleteWorkspaceGroupAtomic,
  getWorkspaceGroup,
  ScimGroupMutationError,
  toScimGroup,
  updateWorkspaceGroupAtomic,
} from '@/lib/scim/groups';
import { applyGroupPatch } from '@/lib/scim/patch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const groupMemberSchema = z.object({ value: z.string().trim().min(1) }).passthrough();
const replaceGroupSchema = z
  .object({
    displayName: z.string().trim().min(1).max(255),
    members: z.array(groupMemberSchema).optional().default([]),
  })
  .passthrough();

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

function groupMutationError(error: unknown) {
  if (error instanceof ScimGroupMutationError) {
    switch (error.code) {
      case 'group_not_found':
        return scimError(404, 'Group not found');
      case 'workspace_unavailable':
        return scimError(403, 'Workspace is unavailable');
      case 'invalid_display_name':
      case 'invalid_members':
        return scimError(400, 'Group contains an invalid value', 'invalidValue');
    }
  }
  if (isUniqueViolation(error)) {
    return scimError(409, 'A group with this identity already exists', 'uniqueness');
  }
  console.error('SCIM group mutation failed:', error);
  return scimError(500, 'Group could not be updated');
}

async function ctx(request: NextRequest, id: string, scope: ScimScope) {
  const auth = await authenticateScimRequest(request.headers.get('authorization'));
  if (!auth) return { error: scimError(401, 'Invalid or missing SCIM token') };
  if (!scimTokenCan(auth, scope)) {
    return { error: scimError(403, `SCIM token lacks ${scope} scope`) };
  }
  const row = await getWorkspaceGroup(auth.workspaceId, id);
  if (!row) return { error: scimError(404, `Group ${id} not found`) };
  return { auth, row };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx(request, id, 'groups:read');
  if ('error' in c) return c.error;
  return scimResponse(toScimGroup(c.row));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx(request, id, 'groups:write');
  if ('error' in c) return c.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Body must be JSON', 'invalidSyntax');
  }
  const parsed = replaceGroupSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, 'displayName and members must be valid', 'invalidValue');
  }
  try {
    const updated = await updateWorkspaceGroupAtomic({
      workspaceId: c.auth.workspaceId,
      groupId: id,
      tokenId: c.auth.tokenId,
      displayName: parsed.data.displayName,
      members: { replace: parsed.data.members.map((member) => member.value) },
    });
    return scimResponse(toScimGroup(updated));
  } catch (error) {
    return groupMutationError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx(request, id, 'groups:write');
  if ('error' in c) return c.error;

  let body: PatchRequest;
  try {
    body = (await request.json()) as PatchRequest;
  } catch {
    return scimError(400, 'Body must be JSON', 'invalidSyntax');
  }
  if (!Array.isArray(body.Operations)) {
    return scimError(400, 'PATCH body missing Operations', 'invalidSyntax');
  }

  let patch;
  try {
    patch = applyGroupPatch(body.Operations);
  } catch (err) {
    return scimError(400, (err as Error).message, 'invalidSyntax');
  }
  try {
    const updated = await updateWorkspaceGroupAtomic({
      workspaceId: c.auth.workspaceId,
      groupId: id,
      tokenId: c.auth.tokenId,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      members: {
        ...(patch.addMembers !== undefined ? { add: patch.addMembers } : {}),
        ...(patch.removeMembers !== undefined ? { remove: patch.removeMembers } : {}),
        ...(patch.replaceMembers !== undefined ? { replace: patch.replaceMembers } : {}),
      },
    });
    return scimResponse(toScimGroup(updated));
  } catch (error) {
    return groupMutationError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = await ctx(request, id, 'groups:write');
  if ('error' in c) return c.error;
  try {
    await deleteWorkspaceGroupAtomic({
      workspaceId: c.auth.workspaceId,
      groupId: id,
      tokenId: c.auth.tokenId,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return groupMutationError(error);
  }
}
