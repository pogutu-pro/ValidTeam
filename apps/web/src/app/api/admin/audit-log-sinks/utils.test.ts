/** @jest-environment node */

import { redactSinkConfig, validateSinkConfig } from './utils';

describe('audit sink configuration', () => {
  const originalAllowInsecure = process.env.ALLOW_INSECURE_AUDIT_SINKS;

  afterEach(() => {
    if (originalAllowInsecure === undefined) {
      delete process.env.ALLOW_INSECURE_AUDIT_SINKS;
    } else {
      process.env.ALLOW_INSECURE_AUDIT_SINKS = originalAllowInsecure;
    }
  });

  it('accepts complete HTTPS webhook and Splunk configurations', () => {
    expect(validateSinkConfig('webhook', { url: 'https://siem.example.com/events' }).success).toBe(
      true
    );
    expect(
      validateSinkConfig('splunk_hec', {
        url: 'https://splunk.example.com/services/collector',
        token: 'secret-token',
        index: 'security',
      }).success
    ).toBe(true);
  });

  it('rejects insecure HTTP destinations unless the explicit operator escape hatch is set', () => {
    delete process.env.ALLOW_INSECURE_AUDIT_SINKS;
    expect(validateSinkConfig('webhook', { url: 'http://siem.example.com/events' }).success).toBe(
      false
    );

    process.env.ALLOW_INSECURE_AUDIT_SINKS = 'true';
    expect(validateSinkConfig('webhook', { url: 'http://siem.example.com/events' }).success).toBe(
      true
    );
  });

  it('rejects credentials and literal non-public destinations', () => {
    for (const url of [
      'https://localhost/events',
      'https://127.0.0.1/events',
      'https://169.254.169.254/latest/meta-data',
      'https://user:password@8.8.8.8/events',
      'https://[::1]/events',
    ]) {
      expect(validateSinkConfig('webhook', { url }).success).toBe(false);
    }
  });

  it('constrains Datadog sites and S3 object prefixes', () => {
    expect(
      validateSinkConfig('datadog', { apiKey: 'key', site: 'attacker.example.com' }).success
    ).toBe(false);
    expect(
      validateSinkConfig('s3', {
        bucket: 'validteam-audit',
        region: 'eu-central-1',
        prefix: '../private',
      }).success
    ).toBe(false);
  });

  it('redacts provider credentials in API responses', () => {
    expect(
      redactSinkConfig('splunk_hec', {
        url: 'https://splunk.example.com/services/collector',
        token: 'secret-token',
      })
    ).toEqual({
      url: 'https://splunk.example.com/services/collector',
      token: '••••••••',
    });
  });
});
