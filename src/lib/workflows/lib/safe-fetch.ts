/**
 * SSRF-guarded fetch for server-side PDF retrieval.
 *
 * The pipeline downloads PDFs server-side in two cases:
 *   1. Pipeline *inputs* hosted on our own PocketBase (Google's url_context
 *      can't reach a private/local host, so we fetch + upload to Gemini).
 *   2. Article *source* PDFs, which are usually public publisher URLs.
 *
 * Both URLs are user-controllable, so a naive `fetch(url)` is an SSRF sink:
 * an authenticated user could point it at `http://localhost:6379/`,
 * `http://169.254.169.254/` (cloud metadata), or any RFC-1918 host and have
 * the server fetch internal responses (which then get surfaced via the model).
 *
 * Policy:
 *   - `trustedHosts` (the configured PocketBase host:port) are always allowed,
 *     even when private — that's our own infra and the whole point of case 1.
 *   - When `allowPublic` is set (case 2), any other host must be *publicly*
 *     routable: private literals are rejected and the hostname is resolved and
 *     re-checked so a public name can't point (or DNS-rebind) to an internal IP.
 *     The validated IPs are then *pinned*: the request is dialed at exactly the
 *     address that passed the check (via an undici connector whose `lookup`
 *     ignores DNS and returns only the pinned set), so a low-TTL record can't
 *     resolve public-then-private between the check and the connect (TOCTOU /
 *     DNS rebinding). SNI/Host stay the original hostname, so TLS still works.
 *   - Redirects are followed manually so every hop is re-validated and re-pinned,
 *     defeating redirect-to-internal bypasses.
 */

import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';
import { env } from '@/env';

export type FetchPolicy = {
  /** host:port values that are always allowed (our own upload host). */
  trustedHosts: Set<string>;
  /** When true, non-trusted hosts are allowed iff they are publicly routable. */
  allowPublic: boolean;
};

const MAX_REDIRECTS = 3;

/** `host:port`, with the protocol default port filled in, lowercased. */
function hostKey(u: URL): string {
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.hostname.toLowerCase()}:${port}`;
}

/**
 * The host:port of our own upload backend(s). Server-side fetches of pipeline
 * inputs are restricted to exactly these — never "any non-public URL".
 */
export function trustedUploadHostKeys(): Set<string> {
  const set = new Set<string>();
  for (const raw of [env.POCKETBASE_URL, env.NEXT_PUBLIC_POCKETBASE_URL]) {
    if (!raw) continue;
    try {
      set.add(hostKey(new URL(raw)));
    } catch {
      /* ignore malformed env value */
    }
  }
  return set;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // RFC-1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC-1918
    (a === 192 && b === 168) // RFC-1918
  );
}

function isPrivateIpv6(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (x === '::1' || x === '::') return true;
  if (x.startsWith('fe80')) return true; // link-local
  if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique local
  const mapped = x.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateIpv4(ip);
  if (fam === 6) return isPrivateIpv6(ip);
  return true; // unparseable → treat as unsafe
}

/** Host literals that are obviously internal without a DNS lookup. */
function isPrivateHostLiteral(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    return true;
  }
  if (isIP(h)) return isPrivateIp(h);
  return false;
}

/** Pre-validated address the connection is pinned to. `family` is 4 or 6. */
type PinnedAddress = { address: string; family: number };

/**
 * Validates `u` against `policy`. Returns the set of pre-validated IPs the
 * connection must be pinned to, or `null` when no pinning is needed (trusted
 * host — own infra, resolved normally — or a public IP literal, where no DNS
 * happens at connect time anyway). Throws if the target is disallowed.
 */
async function assertAllowed(
  u: URL,
  policy: FetchPolicy,
): Promise<PinnedAddress[] | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`refusing non-http(s) URL: ${u.protocol}//`);
  }
  // Our own upload host is always allowed (it is intentionally private in dev).
  if (policy.trustedHosts.has(hostKey(u))) return null;
  if (!policy.allowPublic) {
    throw new Error(`host not in upload allowlist: ${u.host}`);
  }
  // Public fetch: reject internal targets, including names that resolve inward.
  const host = u.hostname.toLowerCase();
  if (isPrivateHostLiteral(host)) {
    throw new Error(`refusing to fetch private host: ${host}`);
  }
  // A public IP literal is dialed directly — no DNS, so nothing to pin.
  if (isIP(host)) return null;
  let addrs: PinnedAddress[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`could not resolve host: ${host}`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`host resolves to a private address: ${host}`);
  }
  return addrs;
}

/**
 * A dispatcher whose connector dials *only* the pre-validated IPs, ignoring DNS
 * entirely. This closes the rebinding window: the address that passed
 * `assertAllowed` is the exact address connected to, so a low-TTL record can't
 * flip public→private between the check and the socket connect. The original
 * hostname is still used for SNI and the Host header, so TLS verification works.
 */
function makePinnedDispatcher(pinned: PinnedAddress[]): Agent {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === 'object' && options?.all) {
      callback(null, pinned as never);
    } else {
      const { address, family } = pinned[0];
      callback(null, address as never, family);
    }
  };
  return new Agent({ connect: { lookup } });
}

/**
 * `fetch` that validates the target (and every redirect hop) against `policy`
 * before each request, pinning the connection to the validated IP. Returns the
 * final non-redirect Response. Throws if any hop is disallowed or the redirect
 * chain is too long.
 */
export async function safeFetch(rawUrl: string, policy: FetchPolicy): Promise<Response> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const pinned = await assertAllowed(current, policy);
    const dispatcher = pinned ? makePinnedDispatcher(pinned) : undefined;
    const init: RequestInit & { dispatcher?: Agent } = { redirect: 'manual' };
    if (dispatcher) init.dispatcher = dispatcher;

    let res: Response;
    try {
      res = await fetch(current.toString(), init);
    } catch (err) {
      // No response was produced — tear the pinned pool down immediately.
      if (dispatcher) void dispatcher.close();
      throw err;
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      // Discard this hop's body and pool; we re-validate + re-pin the next hop.
      void res.body?.cancel();
      if (dispatcher) void dispatcher.close();
      if (!loc) return res;
      try {
        current = new URL(loc, current);
      } catch {
        throw new Error(`invalid redirect target: ${loc}`);
      }
      continue;
    }
    // Final response: graceful close completes once the caller drains the body.
    if (dispatcher) void dispatcher.close();
    return res;
  }
  throw new Error('too many redirects');
}
