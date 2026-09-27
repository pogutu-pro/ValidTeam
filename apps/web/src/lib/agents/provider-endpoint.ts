import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export class UnsafeAgentProviderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeAgentProviderEndpointError';
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? '';
  const groups = normalized.split(':');
  const firstGroup = Number.parseInt(groups[0] || '0', 16);
  const secondGroup = Number.parseInt(groups[1] || '0', 16);

  // Provider callbacks only need globally routable unicast destinations.
  // Restricting literals and DNS answers to 2000::/3 also rejects loopback,
  // ULA/link-local, multicast, IPv4-mapped (including hexadecimal spellings),
  // NAT64 well-known prefixes, and other special-purpose ranges that can
  // otherwise bypass dotted-IPv4 checks.
  if (!Number.isInteger(firstGroup) || (firstGroup & 0xe000) !== 0x2000) {
    return true;
  }

  // Documentation and IETF protocol-assignment blocks are not valid provider
  // destinations. Keep them out even though they sit inside global unicast.
  if (
    normalized.startsWith('2001:db8:') ||
    normalized === '2001:db8::' ||
    /^2001:0{0,3}[0-7]:/.test(normalized) ||
    (firstGroup === 0x3fff && secondGroup <= 0x0fff)
  ) {
    return true;
  }

  // 6to4 embeds an IPv4 destination in groups two and three. Reject a 6to4
  // spelling whenever that embedded address would be rejected directly.
  const sixToFour = normalized.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) {
    const high = Number.parseInt(sixToFour[1]!, 16);
    const low = Number.parseInt(sixToFour[2]!, 16);
    const embedded = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

function configuredHostAllowlist(): string[] {
  return (process.env.AGENT_PROVIDER_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

export function hostMatchesAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  const candidate = normalizeHostname(hostname);
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return candidate.endsWith(suffix) && candidate !== suffix.slice(1);
    }
    return candidate === entry;
  });
}

/**
 * Validate a remotely configured agent endpoint before server-side dispatch.
 * HTTPS, optional explicit host policy, and public DNS answers are required.
 * Local CLI endpoints are handled by local-runner.ts and never reach here.
 */
interface ResolvedAgentProviderEndpoint {
  endpoint: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

export type PublicEndpointPolicy = {
  allowInsecureHttp?: boolean;
  hostAllowlist?: readonly string[];
};

async function resolvePublicEndpoint(
  rawEndpoint: string,
  policy: PublicEndpointPolicy = {}
): Promise<ResolvedAgentProviderEndpoint> {
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint is not a valid URL.');
  }

  if (
    endpoint.protocol !== 'https:' &&
    !(policy.allowInsecureHttp === true && endpoint.protocol === 'http:')
  ) {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint must use HTTPS.');
  }
  if (endpoint.username || endpoint.password) {
    throw new UnsafeAgentProviderEndpointError(
      'Agent provider endpoint must not embed credentials.'
    );
  }

  const hostname = normalizeHostname(endpoint.hostname);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint host is not public.');
  }

  const allowlist = policy.hostAllowlist ?? [];
  if (allowlist.length > 0 && !hostMatchesAllowlist(hostname, allowlist)) {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint host is not allowlisted.');
  }

  const literalFamily = isIP(hostname);
  if (literalFamily && !isPublicNetworkAddress(hostname)) {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint address is not public.');
  }

  let answers: Array<{ address: string; family: number }> = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : [];
  if (!literalFamily) {
    try {
      answers = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new UnsafeAgentProviderEndpointError(
        'Agent provider endpoint host could not be resolved.'
      );
    }
  }

  if (answers.length === 0 || answers.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new UnsafeAgentProviderEndpointError(
      'Agent provider endpoint resolved to a non-public address.'
    );
  }

  return {
    endpoint,
    addresses: answers.map(({ address, family }) => ({
      address,
      family: family as 4 | 6,
    })),
  };
}

export async function validateAgentProviderEndpoint(rawEndpoint: string): Promise<URL> {
  return (
    await resolvePublicEndpoint(rawEndpoint, {
      hostAllowlist: configuredHostAllowlist(),
    })
  ).endpoint;
}

/**
 * Validate any administrator-configured outbound HTTP endpoint using the same
 * public-network and DNS policy that is enforced again at connection time.
 * Callers can use this before persisting configuration so operators receive
 * immediate feedback, while `postPublicEndpoint` remains the authoritative
 * runtime check against DNS rebinding and stale configuration.
 */
export async function validatePublicEndpoint(
  rawEndpoint: string,
  policy: PublicEndpointPolicy = {}
): Promise<URL> {
  return (await resolvePublicEndpoint(rawEndpoint, policy)).endpoint;
}

export interface PublicEndpointPostOptions {
  body: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  /** Capture at most this many response bytes. Omit to discard the body. */
  maxResponseBytes?: number;
}

export interface PublicEndpointPostResponse {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Send one non-redirecting HTTPS request to a freshly validated and pinned
 * public address. The custom lookup closes the DNS-rebinding window between
 * policy validation and the TCP connection; 3xx responses are returned as
 * failures and are never followed to a second destination.
 */
export async function postAgentProviderEndpoint(
  rawEndpoint: string,
  options: PublicEndpointPostOptions
): Promise<PublicEndpointPostResponse> {
  return postPublicEndpoint(rawEndpoint, options, {
    hostAllowlist: configuredHostAllowlist(),
  });
}

/**
 * POST to a public endpoint while pinning the DNS answer used by the socket.
 * This is also used by administrator-configured outbound integrations such
 * as audit sinks, where validating and connecting in separate calls would
 * leave a DNS-rebinding window.
 */
export async function postPublicEndpoint(
  rawEndpoint: string,
  options: PublicEndpointPostOptions,
  policy: PublicEndpointPolicy = {}
): Promise<PublicEndpointPostResponse> {
  const { endpoint, addresses } = await resolvePublicEndpoint(rawEndpoint, policy);
  const pinned = addresses[0];
  if (!pinned) {
    throw new UnsafeAgentProviderEndpointError('Agent provider endpoint has no public address.');
  }

  return new Promise<PublicEndpointPostResponse>((resolve, reject) => {
    const requestFn = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestFn(
      endpoint,
      {
        method: 'POST',
        headers: options.headers,
        signal: options.signal,
        family: pinned.family,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const maxResponseBytes = Math.max(0, options.maxResponseBytes ?? 0);
        if (maxResponseBytes === 0) {
          response.resume();
          resolve({ ok: status >= 200 && status < 300, status, body: '' });
          return;
        }

        const chunks: Buffer[] = [];
        let capturedBytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          if (capturedBytes >= maxResponseBytes) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = maxResponseBytes - capturedBytes;
          const captured = buffer.subarray(0, remaining);
          chunks.push(captured);
          capturedBytes += captured.length;
        });
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    request.once('error', reject);
    request.end(options.body);
  });
}
