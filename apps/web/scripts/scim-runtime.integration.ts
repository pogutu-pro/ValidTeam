/**
 * Real HTTP + Postgres verification for the SCIM user/group lifecycle.
 * Requires an explicit disposable database and a loopback development server.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
const appBaseUrl = process.env.TEST_APP_BASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required; refusing to run against an implicit database');
}
if (!appBaseUrl) {
  throw new Error('TEST_APP_BASE_URL is required');
}
const appUrl = new URL(appBaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(appUrl.hostname)) {
  throw new Error('SCIM runtime integration is restricted to a loopback development server');
}

const sql = postgres(databaseUrl, { max: 4 });
const suffix = randomUUID().replaceAll('-', '');
const ids = {
  organization: `scim_org_${suffix}`,
  sharedOrganization: `scim_shared_org_${suffix}`,
  token: `scim_token_${suffix}`,
  sharedUser: `scim_shared_user_${suffix}`,
  membership: `scim_member_${suffix}`,
  sharedMembership: `scim_shared_member_${suffix}`,
};
const bearer = `scim_${randomBytes(32).toString('base64url')}`;
let provisionedUserId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function scim(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, appUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/scim+json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body: body as Record<string, any> | null };
}

async function main() {
  const tokenHash = await bcrypt.hash(bearer, 12);
  await sql`
    insert into organizations (id, name, slug, status)
    values
      (${ids.organization}, ${`SCIM Audit ${suffix}`}, ${`scim-audit-${suffix}`}, 'active'),
      (${ids.sharedOrganization}, ${`SCIM Shared ${suffix}`}, ${`scim-shared-${suffix}`}, 'active')
  `;
  await sql`
    insert into scim_tokens (
      id, workspace_id, token_hash, token_digest, token_prefix, name, scopes
    )
    values (
      ${ids.token},
      ${ids.organization},
      ${tokenHash},
      ${createHash('sha256').update(bearer, 'utf8').digest('hex')},
      ${bearer.slice(0, 12)},
      'functional-audit',
      ARRAY['users:read', 'users:write', 'groups:read', 'groups:write']::text[]
    )
  `;
  const sharedEmail = `shared-${suffix}@example.test`;
  await sql`
    insert into users (id, email, name, status)
    values (${ids.sharedUser}, ${sharedEmail}, 'Shared Identity', 'active')
  `;
  await sql`
    insert into organization_members (id, organization_id, user_id, role, status)
    values
      (${ids.membership}, ${ids.organization}, ${ids.sharedUser}, 'member', 'active'),
      (${ids.sharedMembership}, ${ids.sharedOrganization}, ${ids.sharedUser}, 'member', 'active')
  `;

  const createdEmail = `created-${suffix}@example.test`;
  const created = await scim('/api/scim/v2/Users', {
    method: 'POST',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: createdEmail,
      name: { givenName: 'SCIM', familyName: 'Created' },
      emails: [{ value: createdEmail, primary: true }],
      active: true,
    }),
  });
  assert(created.response.status === 201, `POST User: ${created.response.status}`);
  provisionedUserId = created.body?.id;
  assert(typeof provisionedUserId === 'string', 'POST User did not return an id');

  const patched = await scim(`/api/scim/v2/Users/${provisionedUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'displayName', value: 'SCIM Renamed' },
        { op: 'Replace', path: 'active', value: false },
      ],
    }),
  });
  assert(patched.response.status === 200, `PATCH User: ${patched.response.status}`);
  assert(
    patched.body?.displayName === 'SCIM Renamed' && patched.body?.active === false,
    'PATCH response is incomplete'
  );
  const [patchedDb] = await sql<{ name: string; status: string }[]>`
    select u.name, om.status
    from users u join organization_members om on om.user_id = u.id
    where u.id = ${provisionedUserId} and om.organization_id = ${ids.organization}
  `;
  assert(
    patchedDb?.name === 'SCIM Renamed' && patchedDb.status === 'inactive',
    'PATCH DB state is incomplete'
  );

  const reactivate = await scim(`/api/scim/v2/Users/${provisionedUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: true }],
    }),
  });
  assert(
    reactivate.response.status === 200 && reactivate.body?.active === true,
    'User reactivation failed'
  );

  const invalidEmail = await scim(`/api/scim/v2/Users/${provisionedUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'userName', value: 'not-an-email' }],
    }),
  });
  assert(
    invalidEmail.response.status === 400 && invalidEmail.body?.scimType === 'invalidValue',
    'Invalid email was not rejected'
  );

  const sharedMutation = await scim(`/api/scim/v2/Users/${ids.sharedUser}`, {
    method: 'PUT',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: `hijacked-${suffix}@example.test`,
      name: { givenName: 'Hijacked' },
      active: true,
    }),
  });
  assert(
    sharedMutation.response.status === 409 && sharedMutation.body?.scimType === 'mutability',
    'Shared identity mutation was not blocked'
  );
  const [sharedAfter] = await sql<{ email: string; name: string }[]>`
    select email, name from users where id = ${ids.sharedUser}
  `;
  assert(
    sharedAfter?.email === sharedEmail && sharedAfter.name === 'Shared Identity',
    'Shared identity was partially mutated'
  );

  const invalidGroup = await scim('/api/scim/v2/Groups', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Must Roll Back',
      members: [{ value: `missing-${suffix}` }],
    }),
  });
  assert(
    invalidGroup.response.status === 400 && invalidGroup.body?.scimType === 'invalidValue',
    'Invalid group member was not rejected'
  );
  const [partialGroup] = await sql<{ count: number }[]>`
    select count(*)::int as count from teams
    where organization_id = ${ids.organization} and name = 'Must Roll Back'
  `;
  assert(partialGroup?.count === 0, 'Invalid group left a partial team row');

  const groupCreate = await scim('/api/scim/v2/Groups', {
    method: 'POST',
    body: JSON.stringify({
      displayName: 'Provisioned Team',
      members: [{ value: provisionedUserId }],
    }),
  });
  assert(groupCreate.response.status === 201, `POST Group: ${groupCreate.response.status}`);
  const groupId = groupCreate.body?.id;
  assert(
    typeof groupId === 'string' && groupCreate.body?.members?.length === 1,
    'POST Group member was not persisted'
  );

  const invalidGroupPatch = await scim(`/api/scim/v2/Groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'displayName', value: 'Partial Rename' },
        { op: 'Add', path: 'members', value: [{ value: `missing-${suffix}` }] },
      ],
    }),
  });
  assert(invalidGroupPatch.response.status === 400, 'Invalid group PATCH was not rejected');
  const groupAfterFailure = await scim(`/api/scim/v2/Groups/${groupId}`);
  assert(
    groupAfterFailure.body?.displayName === 'Provisioned Team',
    'Group PATCH partially committed'
  );

  const groupReplace = await scim(`/api/scim/v2/Groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify({
      displayName: 'Provisioned Team Renamed',
      members: [{ value: provisionedUserId }],
    }),
  });
  assert(
    groupReplace.response.status === 200 &&
      groupReplace.body?.displayName === 'Provisioned Team Renamed',
    'PUT Group failed'
  );

  const unsupportedFilter = await scim('/api/scim/v2/Users?filter=displayName%20co%20%22x%22');
  assert(
    unsupportedFilter.response.status === 400 &&
      unsupportedFilter.body?.scimType === 'invalidFilter',
    'Unsupported filter was accepted'
  );
  const badPagination = await scim('/api/scim/v2/Users?startIndex=wat&count=wat');
  assert(
    badPagination.response.status === 200 && badPagination.body?.startIndex === 1,
    'Invalid pagination was not normalized'
  );

  const groupDelete = await scim(`/api/scim/v2/Groups/${groupId}`, { method: 'DELETE' });
  assert(groupDelete.response.status === 204, `DELETE Group: ${groupDelete.response.status}`);

  await sql`
    update scim_tokens set scopes = ARRAY['users:read']::text[] where id = ${ids.token}
  `;
  const scopedUserRead = await scim('/api/scim/v2/Users?count=1');
  assert(scopedUserRead.response.status === 200, 'users:read scope did not permit user listing');
  const scopedGroupRead = await scim('/api/scim/v2/Groups?count=1');
  assert(scopedGroupRead.response.status === 403, 'Missing groups:read scope was not enforced');
  const scopedUserWrite = await scim(`/api/scim/v2/Users/${provisionedUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: false }],
    }),
  });
  assert(scopedUserWrite.response.status === 403, 'Missing users:write scope was not enforced');

  const [tokenState] = await sql<{ last_used_at: Date | null; token_digest: string | null }[]>`
    select last_used_at, token_digest from scim_tokens where id = ${ids.token}
  `;
  assert(
    tokenState?.last_used_at instanceof Date,
    'Indexed token usage timestamp was not recorded'
  );
  assert(tokenState.token_digest?.length === 64, 'Indexed token digest was not persisted');

  const audits = await sql<{ action: string; organization_id: string }[]>`
    select action, organization_id from system_audit_logs where user_id = ${`scim:${ids.token}`}
  `;
  const actions = new Set(audits.map((row) => row.action));
  for (const action of [
    'scim.user.provisioned',
    'scim.user.updated',
    'scim.group.created',
    'scim.group.updated',
    'scim.group.deleted',
  ]) {
    assert(actions.has(action), `Missing audit action ${action}`);
  }
  assert(
    audits.every((row) => row.organization_id === ids.organization),
    'Audit escaped workspace scope'
  );

  console.log(
    JSON.stringify({
      ok: true,
      userLifecycle: [created.response.status, patched.response.status, reactivate.response.status],
      sharedIdentity: sharedMutation.body?.scimType,
      invalidGroupRolledBack: partialGroup?.count === 0,
      groupLifecycle: [
        groupCreate.response.status,
        groupReplace.response.status,
        groupDelete.response.status,
      ],
      scopeEnforcement: [
        scopedUserRead.response.status,
        scopedGroupRead.response.status,
        scopedUserWrite.response.status,
      ],
      indexedLookup: tokenState.token_digest?.length === 64,
      auditActions: [...actions].sort(),
    })
  );
}

async function run() {
  try {
    await main();
  } finally {
    await sql`delete from system_audit_logs where organization_id in (${ids.organization}, ${ids.sharedOrganization})`;
    await sql`delete from organizations where id in (${ids.organization}, ${ids.sharedOrganization})`;
    if (provisionedUserId) await sql`delete from users where id = ${provisionedUserId}`;
    await sql`delete from users where id = ${ids.sharedUser}`;
    await sql.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
