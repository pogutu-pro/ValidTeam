/**
 * SCIM 2.0 single-User endpoints.
 *
 *   GET    /Users/{id}        → Read user
 *   PUT    /Users/{id}        → Replace (Okta uses this)
 *   PATCH  /Users/{id}        → Modify (Entra ID uses this)
 *   DELETE /Users/{id}        → De-provision
 */
import { NextRequest } from 'next/server';
import { authenticateScimRequest, scimTokenCan } from '@/lib/sso/tokens';
import type { ScimScope } from '@/lib/scim/scopes';
import { scimError, scimResponse } from '@/lib/scim/types';
import {
  getWorkspaceUser,
  ScimUserMutationError,
  toScimUser,
  updateWorkspaceUserAtomic,
} from '@/lib/scim/users';
import { applyUserPatch } from '@/lib/scim/patch';
import type { PatchRequest } from '@/lib/scim/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

function userMutationError(error: unknown) {
  if (error instanceof ScimUserMutationError) {
    switch (error.code) {
      case 'user_not_found':
        return scimError(404, 'User not found');
      case 'invalid_email':
        return scimError(400, 'A valid userName or primary email is required', 'invalidValue');
      case 'email_conflict':
        return scimError(409, 'The requested userName is already in use', 'uniqueness');
      case 'shared_identity':
        return scimError(
          409,
          'This shared identity cannot be modified by a single workspace',
          'mutability'
        );
    }
  }
  if (isUniqueViolation(error)) {
    return scimError(409, 'The requested userName is already in use', 'uniqueness');
  }
  console.error('SCIM user mutation failed:', error);
  return scimError(500, 'User could not be updated');
}

async function authedUser(request: NextRequest, id: string, scope: ScimScope) {
  const auth = await authenticateScimRequest(request.headers.get('authorization'));
  if (!auth) return { error: scimError(401, 'Invalid or missing SCIM token') };
  if (!scimTokenCan(auth, scope)) {
    return { error: scimError(403, `SCIM token lacks ${scope} scope`) };
  }
  const row = await getWorkspaceUser(auth.workspaceId, id);
  if (!row) return { error: scimError(404, `User ${id} not found`) };
  return { auth, row };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authedUser(request, id, 'users:read');
  if ('error' in ctx) return ctx.error;
  return scimResponse(toScimUser(ctx.row));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authedUser(request, id, 'users:write');
  if ('error' in ctx) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Body must be JSON', 'invalidSyntax');
  }

  const userName = typeof body.userName === 'string' ? body.userName : ctx.row.email;
  const name = (body.name ?? {}) as { givenName?: string; familyName?: string };
  const formatted =
    [name.givenName, name.familyName].filter((x): x is string => !!x && x.length > 0).join(' ') ||
    ctx.row.name;
  const active = typeof body.active === 'boolean' ? body.active : true;

  try {
    const updated = await updateWorkspaceUserAtomic({
      workspaceId: ctx.auth.workspaceId,
      userId: id,
      tokenId: ctx.auth.tokenId,
      patch: { email: userName, name: formatted ?? null },
      membershipStatus: active ? 'active' : 'inactive',
    });
    return scimResponse(toScimUser(updated));
  } catch (error) {
    return userMutationError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authedUser(request, id, 'users:write');
  if ('error' in ctx) return ctx.error;

  let body: PatchRequest;
  try {
    body = (await request.json()) as PatchRequest;
  } catch {
    return scimError(400, 'Body must be JSON', 'invalidSyntax');
  }
  if (!Array.isArray(body.Operations)) {
    return scimError(400, 'PATCH body missing Operations', 'invalidSyntax');
  }

  const [givenName, ...rest] = (ctx.row.name ?? '').split(' ');
  let patch;
  try {
    patch = applyUserPatch(body.Operations, {
      userName: ctx.row.email,
      name: { givenName, familyName: rest.join(' ') },
      displayName: ctx.row.name,
      active: ctx.row.membership.status === 'active',
    });
  } catch (err) {
    return scimError(400, (err as Error).message, 'invalidSyntax');
  }

  // Re-assemble name from given / family if either changed.
  const nextGiven = patch.givenName ?? givenName ?? null;
  const nextFamily = patch.familyName ?? rest.join(' ') ?? null;
  const recombined = [nextGiven, nextFamily]
    .filter((x): x is string => !!x && x.length > 0)
    .join(' ');
  const nextName = patch.displayName !== undefined ? patch.displayName : recombined || null;

  try {
    const updated = await updateWorkspaceUserAtomic({
      workspaceId: ctx.auth.workspaceId,
      userId: id,
      tokenId: ctx.auth.tokenId,
      patch: {
        email: patch.userName ?? patch.primaryEmail,
        name: nextName,
      },
      ...(typeof patch.active === 'boolean'
        ? { membershipStatus: patch.active ? 'active' : 'inactive' }
        : {}),
    });
    return scimResponse(toScimUser(updated));
  } catch (error) {
    return userMutationError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await authedUser(request, id, 'users:write');
  if ('error' in ctx) return ctx.error;
  // Soft-de-provision: flip membership to inactive instead of deleting the
  // global user row (the same person may belong to multiple workspaces).
  try {
    await updateWorkspaceUserAtomic({
      workspaceId: ctx.auth.workspaceId,
      userId: id,
      tokenId: ctx.auth.tokenId,
      patch: {},
      membershipStatus: 'inactive',
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return userMutationError(error);
  }
}
