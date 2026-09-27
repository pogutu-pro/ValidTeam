import {
  isDurableSessionValid,
  normalizeClaimedSessionVersion,
  shouldRotateSessionVersion,
} from '../session-revocation';

describe('durable JWT session revocation', () => {
  it('keeps legacy version-zero sessions valid before the first revocation', () => {
    expect(isDurableSessionValid({ status: 'active', sessionVersion: 0 }, undefined)).toBe(true);
  });

  it('does not resurrect an old JWT after the user is reactivated', () => {
    expect(isDurableSessionValid({ status: 'active', sessionVersion: 1 }, 0)).toBe(false);
    expect(isDurableSessionValid({ status: 'active', sessionVersion: 1 }, 1)).toBe(true);
  });

  it('rejects inactive actors regardless of token version', () => {
    expect(isDurableSessionValid({ status: 'inactive', sessionVersion: 4 }, 4)).toBe(false);
  });

  it('normalizes missing or malformed legacy claims to zero', () => {
    expect(normalizeClaimedSessionVersion(undefined)).toBe(0);
    expect(normalizeClaimedSessionVersion(-1)).toBe(0);
    expect(normalizeClaimedSessionVersion('1')).toBe(0);
  });

  it('rotates versions only when transitioning into a non-active state', () => {
    expect(shouldRotateSessionVersion('active', 'inactive')).toBe(true);
    expect(shouldRotateSessionVersion('active', 'invited')).toBe(true);
    expect(shouldRotateSessionVersion('inactive', 'active')).toBe(false);
    expect(shouldRotateSessionVersion('inactive', 'inactive')).toBe(false);
    expect(shouldRotateSessionVersion('active', undefined)).toBe(false);
  });
});
