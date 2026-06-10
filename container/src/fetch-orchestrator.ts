import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserEngine } from './engine.js';
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
  if (pre.kind === 'http-error') {
    return { outcome: 'http-error', status: pre.status ?? 0 };
  }
  if (pre.kind === 'cross-host') {
    return {
      outcome: 'cross-host-redirect',
      fromUrl: pre.fromUrl!, toUrl: pre.toUrl!,
    };
  }

  const finalUrl = pre.finalUrl!;
  const contentType = pre.contentType ?? '';
  const category = classifyContentType(contentType);
  const dir = join(dataRoot, input.cachePath);
  await mkdir(dir, { recursive: true });

  // Non-HTML, or caller asked for raw only: save the body, return the URI.
  if (category !== 'html' || input.rawOnly) {
    const ext = getFileExtension(contentType);
    const rawName = `raw.${ext}`;
    const body = pre.body ?? Buffer.alloc(0);
    await writeFile(join(dir, rawName), body);
    return {
      outcome: 'fetched',
      status: pre.status ?? 200,
      finalUrl,
      contentType,
      category,
      etag: pre.etag,
      lastModified: pre.lastModified,
      meta: {},
      sections: [],
      files: { raw: rawName },
      bytes: { raw: body.length },
    };
  }

  // HTML: render (JS executes) then convert. Fall back to the pre-flight
  // body if rendering fails or runs out of time.
  let html: string;
  let status = pre.status ?? 200;
  try {
    if (remaining() < 500) throw new Error('no time budget to render');
    const rendered = await engine.render(finalUrl, baseHeaders(), remaining());
    html = rendered.html;
    status = rendered.status || status;
  } catch {
    html = pre.body ? pre.body.toString('utf8') : '';
  }

  const { markdown, meta } = await convertHtml(html, finalUrl);
  const sections = buildStructure(markdown);

  const rawName = 'raw.html';
  const mdName = 'content.md';
  const structName = 'structure.json';
  await writeFile(join(dir, rawName), html, 'utf8');
  await writeFile(join(dir, mdName), markdown, 'utf8');
  await writeFile(
    join(dir, structName), JSON.stringify(sections, null, 2), 'utf8',
  );

  return {
    outcome: 'fetched',
    status,
    finalUrl,
    contentType,
    category,
    etag: pre.etag,
    lastModified: pre.lastModified,
    meta,
    sections,
    files: { raw: rawName, markdown: mdName, structure: structName },
    bytes: {
      raw: Buffer.byteLength(html, 'utf8'),
      markdown: Buffer.byteLength(markdown, 'utf8'),
    },
  };
}
