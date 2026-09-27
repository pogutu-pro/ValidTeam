/** @jest-environment node */

import {
  isProtectedSsoPrivateKey,
  protectSsoPrivateKey,
  revealSsoPrivateKey,
} from '../private-key';

describe('SSO private-key at-rest protection', () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-only-sso-encryption-secret-32-bytes';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  });

  it('encrypts with a randomized authenticated envelope and decrypts losslessly', () => {
    const plaintext = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
    const first = protectSsoPrivateKey(plaintext);
    const second = protectSsoPrivateKey(plaintext);

    expect(first).not.toContain(plaintext);
    expect(first).not.toBe(second);
    expect(isProtectedSsoPrivateKey(first)).toBe(true);
    expect(revealSsoPrivateKey(first)).toBe(plaintext);
    expect(protectSsoPrivateKey(first)).toBe(first);
  });

  it('keeps legacy plaintext readable until the next configuration save', () => {
    expect(revealSsoPrivateKey('legacy-pem')).toBe('legacy-pem');
    expect(revealSsoPrivateKey(null)).toBeNull();
  });

  it('fails closed for a corrupt encrypted envelope', () => {
    expect(() => revealSsoPrivateKey('tn-sso-key:v1:not-json')).toThrow(/envelope/i);
  });
});
