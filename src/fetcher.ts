import type { FetchResult } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; ' +
  'compatible; Claude-User/1.0; +Claude-User@anthropic.com)';

const MAX_REDIRECTS = 5;

export function normaliseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }
  return parsed.href;
}

export async function fetchWithTimeout(
  url: string,
  timeoutSeconds: number,
): Promise<FetchResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT },
  });

  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? '';
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  return { status: res.status, contentType, headers, body, url };
}

export type RedirectResult =
  | { type: 'cross-host'; fromUrl: string; toUrl: string }
  | { type: 'content'; result: FetchResult };

export async function fetchWithRedirects(
  url: string,
  timeoutSeconds: number,
): Promise<RedirectResult> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await fetchWithTimeout(currentUrl, timeoutSeconds);

    if (result.status < 300 || result.status >= 400) {
      return { type: 'content', result };
    }

    const location = result.headers['location'];
    if (!location) {
      return { type: 'content', result };
    }

    const targetUrl = new URL(location, currentUrl).href;
    const sourceHost = new URL(currentUrl).host;
    const targetHost = new URL(targetUrl).host;

    if (sourceHost !== targetHost) {
      return {
        type: 'cross-host',
        fromUrl: currentUrl,
        toUrl: targetUrl,
      };
    }

    currentUrl = targetUrl;
  }

  throw new Error(
    `Too many redirects (>${MAX_REDIRECTS}) following ${url}`
  );
}
