/**
 * @jest-environment node
 *
 * SCIM bearer-token hashing + verification.
 */

import {
  digestScimToken,
  generateScimToken,
  hashScimToken,
  scimTokenCan,
  verifyScimToken,
} from '../tokens';

describe('SCIM token hashing', () => {
  it('produces an scim_-prefixed token of reasonable length', () => {
    const { token, prefix } = generateScimToken();
    expect(token.startsWith('scim_')).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect(prefix.startsWith('scim_')).toBe(true);
    expect(prefix.length).toBe(12);
  });

  it('hash + verify round-trips a valid token', async () => {
    const { token } = generateScimToken();
    const hash = await hashScimToken(token);
    expect(hash).not.toBe(token);
    expect(await verifyScimToken(token, hash)).toBe(true);
  });

  it('rejects a tampered token', async () => {
    const { token } = generateScimToken();
    const hash = await hashScimToken(token);
    const tampered = token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await verifyScimToken(tampered, hash)).toBe(false);
  });

  it('rejects an unrelated token against a stored hash', async () => {
    const a = generateScimToken().token;
    const b = generateScimToken().token;
    const hashA = await hashScimToken(a);
    expect(await verifyScimToken(b, hashA)).toBe(false);
  });

  it('returns false on empty inputs without throwing', async () => {
    expect(await verifyScimToken('', 'some-hash')).toBe(false);
    expect(await verifyScimToken('scim_x', '')).toBe(false);
  });

  it('builds a stable, non-secret lookup digest', () => {
    const token = generateScimToken().token;
    expect(digestScimToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestScimToken(token)).toBe(digestScimToken(token));
    expect(digestScimToken(`${token.slice(0, -1)}x`)).not.toBe(digestScimToken(token));
  });

  it('enforces explicit scopes while retaining legacy empty-scope compatibility', () => {
    const base = { tokenId: 'token_1', workspaceId: 'org_1' };
    expect(scimTokenCan({ ...base, scopes: ['users:read'] }, 'users:read')).toBe(true);
    expect(scimTokenCan({ ...base, scopes: ['users:read'] }, 'users:write')).toBe(false);
    expect(scimTokenCan({ ...base, scopes: [] }, 'groups:write')).toBe(true);
  });
});
