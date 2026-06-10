import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserEngine, RenderResult } from './engine.js';
import { USER_AGENT } from './engine.js';
import {
  classifyContentType, getFileExtension, convertHtml,
  type DocumentMeta,
} from './converter.js';
import { buildStructure, type Section } from './structure.js';

const MAX_REDIRECTS = 5;

export interface FetchInput {
  url: string;
  cachePath: string; // "<domain>/<sha256>" relative to dataRoot
  timeoutSeconds: number;
  rawOnly: boolean;
  validators?: { etag?: string; lastModified?: string };
}

export type FetchOutcome =
  | {
      outcome: 'fetched';
      status: number;
      finalUrl: string;
      contentType: string;
      category: string;
      etag?: string;
      lastModified?: string;
      meta: DocumentMeta;
      sections: Section[];
      files: { raw: string; markdown?: string; structure?: string };
      bytes: { raw: number; markdown?: number };
    }
  | { outcome: 'not-modified' }
  | { outcome: 'cross-host-redirect'; fromUrl: string; toUrl: string }
  | { outcome: 'http-error'; status: number }
  | { outcome: 'timeout' }
  | { outcome: 'fetch-failed'; reason: string };

function baseHeaders(v?: FetchInput['validators']): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (v?.etag) h['If-None-Match'] = v.etag;
  if (v?.lastModified) h['If-Modified-Since'] = v.lastModified;
  return h;
}

interface Preflight {
  kind: 'content' | 'not-modified' | 'http-error' | 'cross-host';
  status?: number;
  finalUrl?: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  body?: Buffer;
  fromUrl?: string;
  toUrl?: string;
}

// Manual redirect loop mirroring v1 semantics: follow same-host (<=5 hops),
// report cross-host, surface 304 and >=400.
async function preflight(
  engine: BrowserEngine, input: FetchInput, timeoutMs: number,
): Promise<Preflight> {
  let currentUrl = input.url;
  const headers = baseHeaders(input.validators);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await engine.request(currentUrl, headers, timeoutMs);
    if (res.status === 304) return { kind: 'not-modified' };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers['location'];
      if (!location) break; // treat as content
      const target = new URL(location, currentUrl).href;
      if (new URL(currentUrl).host !== new URL(target).host) {
        return { kind: 'cross-host', fromUrl: currentUrl, toUrl: target };
      }
      currentUrl = target;
      continue;
    }
    if (res.status >= 400) return { kind: 'http-error', status: res.status };
    return {
      kind: 'content',
      status: res.status,
      finalUrl: currentUrl,
      contentType: res.headers['content-type'] ?? '',
      etag: res.headers['etag'],
      lastModified: res.headers['last-modified'],
      body: await res.body(),
    };
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) following ${input.url}`);
}

// Orchestrates one fetch: pre-flight (redirects/validators), content-type
// branch, render+convert HTML or save raw, write files under dataRoot.
export async function orchestrateFetch(
  engine: BrowserEngine,
  dataRoot: string,
  input: FetchInput,
): Promise<FetchOutcome> {
  const timeoutMs = input.timeoutSeconds * 1000;
  const deadline = Date.now() + timeoutMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());

  let pre: Preflight;
  try {
    pre = await preflight(engine, input, timeoutMs);
  } catch (err) {
    return {
      outcome: 'fetch-failed',
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (pre.kind === 'not-modified') return { outcome: 'not-modified' };
  if (pre.kind === 'cross-host') {
    return {
      outcome: 'cross-host-redirect',
      fromUrl: pre.fromUrl!, toUrl: pre.toUrl!,
    };
  }

  const dir = join(dataRoot, input.cachePath);

  // The plain pre-flight was rejected with a status that commonly signals
  // bot protection (e.g. Stack Overflow returns 402). The pre-flight uses a
  // plain HTTP client that lacks CloakBrowser's fingerprint, so escalate to
  // a full stealth navigation, which may pass where the plain request did
  // not. Skipped for raw_only (that explicitly wants the unrendered bytes).
  if (pre.kind === 'http-error') {
    if (!input.rawOnly && BLOCK_STATUSES.has(pre.status ?? 0)) {
      const viaRender = await renderFetch(engine, input.url, dir, remaining());
      if (viaRender) return viaRender;
    }
    return { outcome: 'http-error', status: pre.status ?? 0 };
  }

  const finalUrl = pre.finalUrl!;
  const contentType = pre.contentType ?? '';
  const category = classifyContentType(contentType);
  await mkdir(dir, { recursive: true });

  // Non-HTML, or caller asked for raw only: save the body, return the URI.
  if (category !== 'html' || input.rawOnly) {
    return writeRaw(dir, {
      finalUrl, contentType, status: pre.status ?? 200,
      etag: pre.etag, lastModified: pre.lastModified,
      body: pre.body ?? Buffer.alloc(0),
    });
  }

  // HTML: render (JS executes) then convert. Fall back to the pre-flight
  // body if rendering fails or runs out of time. Prefer the render
  // response's validators (it is the authoritative resource response).
  const rendered = await safeRender(engine, finalUrl, remaining());
  const html = rendered?.html ?? (pre.body ? pre.body.toString('utf8') : '');
  return convertWrite(dir, {
    finalUrl,
    contentType,
    status: rendered?.status || pre.status || 200,
    etag: rendered?.headers['etag'] ?? pre.etag,
    lastModified: rendered?.headers['last-modified'] ?? pre.lastModified,
    html,
  });
}

// Statuses that commonly indicate bot protection rather than a genuine
// client/server error, worth retrying through the stealth browser. (401 is
// excluded — it means real auth is required, which rendering will not fix.)
const BLOCK_STATUSES = new Set([402, 403, 429, 503]);

async function safeRender(
  engine: BrowserEngine, url: string, remainingMs: number,
): Promise<RenderResult | null> {
  if (remainingMs < 500) return null;
  try {
    return await engine.render(url, baseHeaders(), remainingMs);
  } catch {
    return null;
  }
}

// Bot-block fallback: navigate with the stealth browser and, if it returns a
// usable response, convert (HTML) or save the bytes (non-HTML). Returns null
// when the navigation also fails, so the caller reports the original error.
async function renderFetch(
  engine: BrowserEngine, url: string, dir: string, remainingMs: number,
): Promise<FetchOutcome | null> {
  const rendered = await safeRender(engine, url, remainingMs);
  if (!rendered || rendered.status >= 400) return null;
  await mkdir(dir, { recursive: true });
  const category = classifyContentType(rendered.contentType);
  if (category === 'html' || rendered.contentType === '') {
    return convertWrite(dir, {
      finalUrl: rendered.finalUrl,
      contentType: rendered.contentType || 'text/html',
      status: rendered.status,
      etag: rendered.headers['etag'],
      lastModified: rendered.headers['last-modified'],
      html: rendered.html,
    });
  }
  // Non-HTML behind bot protection: best-effort fetch of the bytes.
  try {
    const res = await engine.request(rendered.finalUrl, baseHeaders(), remainingMs);
    if (res.status >= 400) return null;
    return writeRaw(dir, {
      finalUrl: rendered.finalUrl,
      contentType: rendered.contentType,
      status: res.status,
      etag: res.headers['etag'],
      lastModified: res.headers['last-modified'],
      body: await res.body(),
    });
  } catch {
    return null;
  }
}

interface RawArgs {
  finalUrl: string; contentType: string; status: number;
  etag?: string; lastModified?: string; body: Buffer;
}

async function writeRaw(dir: string, a: RawArgs): Promise<FetchOutcome> {
  const rawName = `raw.${getFileExtension(a.contentType)}`;
  await writeFile(join(dir, rawName), a.body);
  return {
    outcome: 'fetched',
    status: a.status,
    finalUrl: a.finalUrl,
    contentType: a.contentType,
    category: classifyContentType(a.contentType),
    etag: a.etag,
    lastModified: a.lastModified,
    meta: {},
    sections: [],
    files: { raw: rawName },
    bytes: { raw: a.body.length },
  };
}

interface ConvertArgs {
  finalUrl: string; contentType: string; status: number;
  etag?: string; lastModified?: string; html: string;
}

async function convertWrite(
  dir: string, a: ConvertArgs,
): Promise<FetchOutcome> {
  const { markdown, meta } = await convertHtml(a.html, a.finalUrl);
  const sections = buildStructure(markdown);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'raw.html'), a.html, 'utf8');
  await writeFile(join(dir, 'content.md'), markdown, 'utf8');
  await writeFile(
    join(dir, 'structure.json'), JSON.stringify(sections, null, 2), 'utf8',
  );
  return {
    outcome: 'fetched',
    status: a.status,
    finalUrl: a.finalUrl,
    contentType: a.contentType,
    category: 'html',
    etag: a.etag,
    lastModified: a.lastModified,
    meta,
    sections,
    files: { raw: 'raw.html', markdown: 'content.md', structure: 'structure.json' },
    bytes: {
      raw: Buffer.byteLength(a.html, 'utf8'),
      markdown: Buffer.byteLength(markdown, 'utf8'),
    },
  };
}
