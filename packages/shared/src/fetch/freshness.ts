import CachePolicy from 'http-cache-semantics';
import type { ArtefactIndexEntry } from '../store/record.js';

// Freshness evaluation (ADR-011 design 2.6, plan M7): wraps
// http-cache-semantics to evaluate whether a stored file artefact's
// index entry is fresh, stale or a miss. Clock injection via `now` keeps
// Date.now out of all logic and tests.

export type FreshnessVerdict =
  | { status: 'fresh' }
  | { status: 'stale' }
  | { status: 'miss' };

export interface FreshnessOptions {
  // Injected clock: must not call Date.now directly.
  now: Date;
}

// Evaluate whether a stored index entry's cached response is fresh, stale
// or absent. The entry's fresh_until field is the primary signal (set from
// CachePolicy at fetch time). If fresh_until is absent, the entry is
// treated as stale (always revalidate). If the entry itself is null, the
// verdict is a miss.
export function evaluateFreshness(
  entry: ArtefactIndexEntry | null, opts: FreshnessOptions,
): FreshnessVerdict {
  if (entry === null) return { status: 'miss' };
  if (entry.fresh_until === undefined) return { status: 'stale' };
  const freshUntil = new Date(entry.fresh_until).getTime();
  const nowMs = opts.now.getTime();
  return nowMs < freshUntil ? { status: 'fresh' } : { status: 'stale' };
}

// Compute the fresh_until ISO timestamp from an HTTP response's cache
// headers using http-cache-semantics. Returns undefined if the response
// is not cacheable or has no positive TTL.
export function computeFreshUntil(
  responseHeaders: Record<string, string>,
  opts: FreshnessOptions,
): string | undefined {
  const req: CachePolicy.Request = {
    url: '/', method: 'GET', headers: {},
  };
  const res: CachePolicy.Response = {
    status: 200, headers: responseHeaders,
  };
  const policy = new CachePolicy(req, res, { shared: false });
  if (!policy.storable()) return undefined;
  const ttlMs = policy.timeToLive();
  if (ttlMs <= 0) return undefined;
  return new Date(opts.now.getTime() + ttlMs).toISOString();
}
