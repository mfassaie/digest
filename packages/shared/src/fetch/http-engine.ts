// The local plain-fetch engine (per-type pipelines design §3/§4.8, plan
// M4): powers `runtime: local` retrieval in-process. Manual same-host
// redirects (≤5 by default), cross-host redirects reported back to the
// caller, conditional validators, and an AbortSignal deadline on every
// request so the no-hang guarantee holds without any container.

export interface HttpValidators {
  etag?: string;
  lastModified?: string;
}

export interface HttpFetchRequest {
  url: string;
  // Overall budget for the whole operation: redirects, retries and body
  // streaming all run inside this deadline.
  timeoutSeconds: number;
  // Extra attempts after a network-level failure (never after a definitive
  // HTTP response). Default 0, per the settings schema.
  retries?: number;
  validators?: HttpValidators;
}

export interface HttpEngineOptions {
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
}

export type HttpFetchOutcome =
  | {
      outcome: 'fetched';
      status: number;
      finalUrl: string;
      contentType?: string;
      bytes: Uint8Array;
      etag?: string;
      lastModified?: string;
    }
  | { outcome: 'not-modified' }
  | { outcome: 'cross-host-redirect'; fromUrl: string; toUrl: string }
  | { outcome: 'http-error'; status: number }
  | { outcome: 'timeout' }
  | { outcome: 'fetch-failed'; reason: string };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;

type Attempt =
  | { kind: 'outcome'; outcome: HttpFetchOutcome }
  | { kind: 'retryable'; reason: string };

function done(outcome: HttpFetchOutcome): Attempt {
  return { kind: 'outcome', outcome };
}

// DOMException is not `instanceof Error` in Node, so go by name.
function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err.cause as { code?: unknown } | undefined)?.code;
    return typeof cause === 'string'
      ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

export async function httpFetch(
  req: HttpFetchRequest, opts: HttpEngineOptions = {},
): Promise<HttpFetchOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = Date.now() + req.timeoutSeconds * 1000;
  const attempts = (req.retries ?? 0) + 1;
  let lastReason = 'fetch failed';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await attemptFetch(req, fetchImpl, maxRedirects, deadline);
    if (result.kind === 'outcome') return result.outcome;
    lastReason = result.reason;
    // Retries share the original budget (design §4.8): once the deadline
    // has passed, a retryable failure is reported as the timeout it is.
    if (Date.now() >= deadline) return { outcome: 'timeout' };
  }
  return { outcome: 'fetch-failed', reason: lastReason };
}

async function attemptFetch(
  req: HttpFetchRequest, fetchImpl: typeof fetch, maxRedirects: number,
  deadline: number,
): Promise<Attempt> {
  let originHost: string;
  try {
    originHost = new URL(req.url).host;
  } catch {
    return done({ outcome: 'fetch-failed', reason: `invalid URL: ${req.url}` });
  }
  const headers: Record<string, string> = {};
  if (req.validators?.etag !== undefined) {
    headers['if-none-match'] = req.validators.etag;
  }
  if (req.validators?.lastModified !== undefined) {
    headers['if-modified-since'] = req.validators.lastModified;
  }

  let current = req.url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return done({ outcome: 'timeout' });
    let res: Response;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers,
      });
    } catch (err) {
      if (isAbortLike(err) || Date.now() >= deadline) {
        return done({ outcome: 'timeout' });
      }
      return { kind: 'retryable', reason: reasonOf(err) };
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (location === null) {
        return done({ outcome: 'http-error', status: res.status });
      }
      let target: URL;
      try {
        target = new URL(location, current);
      } catch {
        return done({
          outcome: 'fetch-failed',
          reason: `invalid redirect location: ${location}`,
        });
      }
      if (target.host !== originHost) {
        return done({
          outcome: 'cross-host-redirect',
          fromUrl: current,
          toUrl: target.href,
        });
      }
      current = target.href;
      continue;
    }
    if (res.status === 304) return done({ outcome: 'not-modified' });
    if (res.status >= 400) {
      return done({ outcome: 'http-error', status: res.status });
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (isAbortLike(err) || Date.now() >= deadline) {
        return done({ outcome: 'timeout' });
      }
      return { kind: 'retryable', reason: reasonOf(err) };
    }
    return done({
      outcome: 'fetched',
      status: res.status,
      finalUrl: current,
      contentType: res.headers.get('content-type') ?? undefined,
      bytes,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
    });
  }
  return done({
    outcome: 'fetch-failed',
    reason: `too many redirects (more than ${maxRedirects})`,
  });
}
