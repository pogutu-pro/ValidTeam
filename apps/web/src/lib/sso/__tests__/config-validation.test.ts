/** @jest-environment node */

import crypto from 'node:crypto';
import tls from 'node:tls';
import {
  certificateFingerprint,
  normalizeSamlCertificate,
  normalizeSamlEntryPoint,
  normalizeSamlPrivateKey,
  SamlConfigValidationError,
} from '../config-validation';

describe('SAML configuration validation', () => {
  it('requires HTTPS except for a development loopback IdP', () => {
    expect(normalizeSamlEntryPoint('https://idp.example.com/sso')).toBe(
      'https://idp.example.com/sso'
    );
    expect(normalizeSamlEntryPoint('http://127.0.0.1:8080/sso')).toBe('http://127.0.0.1:8080/sso');
    expect(() => normalizeSamlEntryPoint('http://idp.example.com/sso')).toThrow(
      SamlConfigValidationError
    );
    expect(() => normalizeSamlEntryPoint('https://user:secret@idp.example.com/sso')).toThrow(
      SamlConfigValidationError
    );
    expect(() => normalizeSamlEntryPoint('https://idp.example.com/sso#fragment')).toThrow(
      SamlConfigValidationError
    );
  });

  it('normalizes and fingerprints a valid X.509 certificate', () => {
    const certificate = tls.rootCertificates[0];
    expect(certificate).toBeDefined();
    const normalized = normalizeSamlCertificate(certificate!);
    expect(normalized).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(certificateFingerprint(normalized)).toMatch(/^[a-f0-9]{64}$/);
    expect(certificateFingerprint(normalized)).toBe(certificateFingerprint(certificate));
  });

  it('rejects malformed certificates', () => {
    expect(() => normalizeSamlCertificate('MIIDnot-a-certificate')).toThrow(/invalid_certificate/);
  });

  it('accepts real PEM private keys and rejects malformed input', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(normalizeSamlPrivateKey(pem)).toContain('BEGIN PRIVATE KEY');
    expect(() => normalizeSamlPrivateKey('not-a-private-key')).toThrow(/invalid_private_key/);
  });
});
