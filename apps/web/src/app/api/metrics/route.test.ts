/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

const previousToken = process.env.METRICS_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = previousToken;
});

describe('GET /api/metrics', () => {
  it('fails closed when metrics authentication is not configured', async () => {
    delete process.env.METRICS_TOKEN;

    const response = await GET(new NextRequest('http://localhost/api/metrics'));

    expect(response.status).toBe(503);
  });

  it('rejects a missing or invalid bearer token', async () => {
    process.env.METRICS_TOKEN = 'a-secure-metrics-token';

    const response = await GET(new NextRequest('http://localhost/api/metrics'));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('returns Prometheus output to the configured collector', async () => {
    process.env.METRICS_TOKEN = 'a-secure-metrics-token';

    const response = await GET(
      new NextRequest('http://localhost/api/metrics', {
        headers: { authorization: 'Bearer a-secure-metrics-token' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    await expect(response.text()).resolves.toContain('nodejs_process_uptime_seconds');
  });
});
