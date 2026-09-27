/**
 * Metrics Endpoint
 *
 * Returns application metrics in Prometheus format. The endpoint fails closed
 * unless METRICS_TOKEN is configured and supplied as a Bearer token.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.METRICS_TOKEN;
  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || expected.length < 16 || presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!process.env.METRICS_TOKEN || process.env.METRICS_TOKEN.length < 16) {
    return NextResponse.json({ error: 'Metrics endpoint is not configured.' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  }

  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();

  // Prometheus format metrics
  const metrics = `
# HELP nodejs_memory_heap_used_bytes Node.js heap memory used
# TYPE nodejs_memory_heap_used_bytes gauge
nodejs_memory_heap_used_bytes ${memoryUsage.heapUsed}

# HELP nodejs_memory_heap_total_bytes Node.js heap memory total
# TYPE nodejs_memory_heap_total_bytes gauge
nodejs_memory_heap_total_bytes ${memoryUsage.heapTotal}

# HELP nodejs_memory_external_bytes Node.js external memory
# TYPE nodejs_memory_external_bytes gauge
nodejs_memory_external_bytes ${memoryUsage.external}

# HELP nodejs_memory_rss_bytes Node.js resident set size
# TYPE nodejs_memory_rss_bytes gauge
nodejs_memory_rss_bytes ${memoryUsage.rss}

# HELP nodejs_process_uptime_seconds Node.js process uptime
# TYPE nodejs_process_uptime_seconds gauge
nodejs_process_uptime_seconds ${uptime}

# HELP nodejs_version_info Node.js version
# TYPE nodejs_version_info gauge
nodejs_version_info{version="${process.version}"} 1
`.trim();

  return new NextResponse(metrics, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
