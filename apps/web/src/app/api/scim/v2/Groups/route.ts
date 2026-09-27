/**
 * SCIM 2.0 Groups collection — list + create.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateScimRequest, scimTokenCan } from '@/lib/sso/tokens';
import { parseScimPagination, scimError, scimResponse, SCIM_SCHEMAS } from '@/lib/scim/types';
import {
  createWorkspaceGroup,
  listWorkspaceGroups,
  ScimGroupMutationError,
  toScimGroup,
} from '@/lib/scim/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createGroupSchema = z
  .object({
    displayName: z.string().trim().min(1).max(255),
    members: z
      .array(z.object({ value: z.string().trim().min(1) }).passthrough())
      .optional()
      .default([]),
  })
  .passthrough();

function groupMutationError(error: unknown) {
  if (error instanceof ScimGroupMutationError) {
    if (error.code === 'workspace_unavailable') {
      return scimError(403, 'Workspace is unavailable');
    }
    if (error.code === 'invalid_display_name' || error.code === 'invalid_members') {
      return scimError(400, 'Group contains an invalid value', 'invalidValue');
    }
  }
  console.error('SCIM group creation failed:', error);
  return scimError(500, 'Group could not be created');
}

export async function GET(request: NextRequest) {
  const auth = await authenticateScimRequest(request.headers.get('authorization'));
  if (!auth) return scimError(401, 'Invalid or missing SCIM token');
  if (!scimTokenCan(auth, 'groups:read')) {
    return scimError(403, 'SCIM token lacks groups:read scope');
  }

  const url = new URL(request.url);
  const { startIndex, count } = parseScimPagination(url.searchParams);

  const { rows, total } = await listWorkspaceGroups(auth.workspaceId, {
    startIndex,
    count,
  });

  return scimResponse({
    schemas: [SCIM_SCHEMAS.listResponse],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map(toScimGroup),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateScimRequest(request.headers.get('authorization'));
  if (!auth) return scimError(401, 'Invalid or missing SCIM token');
  if (!scimTokenCan(auth, 'groups:write')) {
    return scimError(403, 'SCIM token lacks groups:write scope');
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Body must be JSON', 'invalidSyntax');
  }
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, 'displayName and members must be valid', 'invalidValue');
  }
  try {
    const created = await createWorkspaceGroup(
      auth.workspaceId,
      parsed.data.displayName,
      parsed.data.members.map((member) => member.value),
      auth.tokenId
    );
    return scimResponse(toScimGroup(created), 201);
  } catch (error) {
    return groupMutationError(error);
  }
}
