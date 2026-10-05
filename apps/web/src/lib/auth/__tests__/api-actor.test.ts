/**
 * @jest-environment node
 */

const authMock = jest.fn();
const selectMock = jest.fn();
const updateMock = jest.fn();
const eqMock = jest.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right }));
const neMock = jest.fn((left: unknown, right: unknown) => ({ type: 'ne', left, right }));

jest.mock('@/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

jest.mock('@validteam/db', () => ({
  apiKeys: {
    id: 'apiKeys.id',
    organizationId: 'apiKeys.organizationId',
    createdBy: 'apiKeys.createdBy',
    key: 'apiKeys.key',
    isActive: 'apiKeys.isActive',
    revokedAt: 'apiKeys.revokedAt',
    expiresAt: 'apiKeys.expiresAt',
    lastUsedAt: 'apiKeys.lastUsedAt',
  },
  users: {
    id: 'users.id',
    status: 'users.status',
  },
  organizationMembers: {
    userId: 'organizationMembers.userId',
    organizationId: 'organizationMembers.organizationId',
    status: 'organizationMembers.status',
  },
  organizations: {
    id: 'organizations.id',
    status: 'organizations.status',
  },
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (...args: unknown[]) => eqMock(...args),
  gt: (left: unknown, right: unknown) => ({ type: 'gt', left, right }),
  isNull: (value: unknown) => ({ type: 'isNull', value }),
  ne: (...args: unknown[]) => neMock(...args),
  or: (...args: unknown[]) => ({ type: 'or', args }),
}));

import crypto from 'node:crypto';
import { apiActorCanAccessOrganization, resolveApiActor } from '../api-actor';

function selectCredential(rows: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    innerJoin: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(rows),
  };
  return builder;
}

function updateCredential() {
  const builder = {
    set: jest.fn(() => builder),
    where: jest.fn().mockResolvedValue(undefined),
  };
  return builder;
}

describe('resolveApiActor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the browser session when no programmatic credential is supplied', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-session' } });

    await expect(resolveApiActor(new Request('https://app.test/api/issues'))).resolves.toEqual({
      userId: 'user-session',
      organizationId: null,
      authType: 'session',
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it.each([
    ['X-API-Key', { 'X-API-Key': 'sk_live_secret' }],
    ['Bearer', { Authorization: 'Bearer sk_live_secret' }],
  ])('resolves an active, organization-bound key supplied via %s', async (_label, headers) => {
    selectMock.mockReturnValue(
      selectCredential([{ id: 'key-1', userId: 'user-1', organizationId: 'org-1' }])
    );
    const updateBuilder = updateCredential();
    updateMock.mockReturnValue(updateBuilder);

    await expect(
      resolveApiActor(new Request('https://app.test/api/issues', { headers }))
    ).resolves.toEqual({
      userId: 'user-1',
      organizationId: 'org-1',
      authType: 'api_key',
      apiKeyId: 'key-1',
    });

    const expectedHash = crypto.createHash('sha256').update('sk_live_secret').digest('hex');
    expect(eqMock).toHaveBeenCalledWith('apiKeys.key', expectedHash);
    expect(neMock).toHaveBeenCalledWith('organizations.status', 'suspended');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'apiKeys.id' }));
    expect(updateBuilder.set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) });
    expect(authMock).not.toHaveBeenCalled();
  });

  it('fails closed when supplied key headers disagree', async () => {
    const request = new Request('https://app.test/api/issues', {
      headers: {
        'X-API-Key': 'sk_live_one',
        Authorization: 'Bearer sk_live_two',
      },
    });

    await expect(resolveApiActor(request)).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
  });

  it('does not fall back to a session for an invalid supplied credential', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-session' } });
    selectMock.mockReturnValue(selectCredential([]));

    await expect(
      resolveApiActor(
        new Request('https://app.test/api/issues', {
          headers: { 'X-API-Key': 'sk_live_revoked_or_unknown' },
        })
      )
    ).resolves.toBeNull();
    expect(authMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported bearer credentials before querying the database', async () => {
    await expect(
      resolveApiActor(
        new Request('https://app.test/api/issues', {
          headers: { Authorization: 'Bearer oauth-not-supported-yet' },
        })
      )
    ).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed X-API-Key before querying the database', async () => {
    await expect(
      resolveApiActor(
        new Request('https://app.test/api/issues', {
          headers: { 'X-API-Key': 'not-a-validteam-key' },
        })
      )
    ).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
    expect(authMock).not.toHaveBeenCalled();
  });
});

describe('apiActorCanAccessOrganization', () => {
  it('confines API keys while allowing a session actor to use route permissions', () => {
    expect(
      apiActorCanAccessOrganization(
        { userId: 'user-1', organizationId: 'org-1', authType: 'api_key' },
        'org-1'
      )
    ).toBe(true);
    expect(
      apiActorCanAccessOrganization(
        { userId: 'user-1', organizationId: 'org-1', authType: 'api_key' },
        'org-2'
      )
    ).toBe(false);
    expect(
      apiActorCanAccessOrganization(
        { userId: 'user-1', organizationId: null, authType: 'session' },
        'org-2'
      )
    ).toBe(true);
  });
});
