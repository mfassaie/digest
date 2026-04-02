import type { PipelineInstruction } from '@digest/shared';
import type { BrowserEngine, RenderResult } from './engine.js';
import {
  classifyContentType, getFileExtension, convertHtml,
  type DocumentMeta,
} from './converter.js';
import { buildStructure, type Section } from './structure.js';

const MAX_REDIRECTS = 5;

export interface FetchInput {
  url: string;
  timeoutSeconds: number;
  rawOnly: boolean;
  validators?: { etag?: string; lastModified?: string };
  // M9: instruction-driven protocol. Absent = legacy behaviour.
  instruction?: PipelineInstruction;
}

// The container is artefact-root-agnostic: it returns the fetched + converted
// content and the host writes it into the session's artefact root. `raw` is
// always base64 (uniform across text and binary); `markdown` is present for
// converted HTML.
export interface FetchContent {
  ext: string;
  raw: string; // base64-encoded raw bytes
  markdown?: string;
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
      content: FetchContent;
    }
  | { outcome: 'not-modified' }
  | { outcome: 'cross-host-redirect'; fromUrl: string; toUrl: string }
  | { outcome: 'http-error'; status: number }
  | { outcome: 'timeout' }
  | { outcome: 'fetch-failed'; reason: string };

// No User-Agent override: CloakBrowser supplies its own default real-Chrome UA,
// consistent with its patched fingerprint. Forcing a self-identifying agent UA
// here defeated the stealth and tripped content negotiation (served markdown).
function baseHeaders(v?: FetchInput['validators']): Record<string, string> {
  const h: Record<string, string> = {};
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
// branch, render+convert HTML or return raw bytes. Returns content; the host
// writes it into the session's artefact root.
//
// M9: when an instruction is present, the retrieval/parser/escalate fields
// drive the branching instead of the hard-coded HTML detection. Absent
// instruction = legacy behaviour (backwards compatible).
export async function orchestrateFetch(
  engine: BrowserEngine,
  input: FetchInput,
): Promise<FetchOutcome> {
  const timeoutMs = input.timeoutSeconds * 1000;
  const deadline = Date.now() + timeoutMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());
  const inst = input.instruction;

  // When instruction says retrieval: 'browser', skip preflight and go
  // straight to a stealth render.
  if (inst?.retrieval === 'browser') {
    const rendered = await safeRender(engine, input.url, remaining());
    if (!rendered || rendered.status >= 400) {
      return rendered
        ? { outcome: 'http-error', status: rendered.status }
        : { outcome: 'fetch-failed', reason: 'browser render failed' };
    }
    const contentType = rendered.contentType || 'text/html';
    const category = classifyContentType(contentType);
    if (inst.parser === 'defuddle' && category === 'html') {
      return convertOutcome({
        finalUrl: rendered.finalUrl,
        contentType,
        status: rendered.status,
        etag: rendered.headers['etag'],
        lastModified: rendered.headers['last-modified'],
        html: rendered.html,
      });
    }
    // Non-defuddle or non-html: return raw rendered HTML bytes.
    return rawOutcome({
      finalUrl: rendered.finalUrl,
      contentType,
      status: rendered.status,
      etag: rendered.headers['etag'],
      lastModified: rendered.headers['last-modified'],
      body: Buffer.from(rendered.html, 'utf8'),
    });
  }

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

  // Bot-block escalation. With an instruction: gated by escalate field.
  // Legacy (no instruction): gated by !rawOnly, same as before.
  if (pre.kind === 'http-error') {
    const shouldEscalate = inst
      ? inst.escalate === 'browser'
      : !input.rawOnly;
    if (shouldEscalate && BLOCK_STATUSES.has(pre.status ?? 0)) {
      const viaRender = await renderFetch(engine, input.url, remaining());
      if (viaRender) return viaRender;
    }
    return { outcome: 'http-error', status: pre.status ?? 0 };
  }

  const finalUrl = pre.finalUrl!;
  const contentType = pre.contentType ?? '';
  const category = classifyContentType(contentType);

  // Instruction-driven parser selection (M9).
  if (inst) {
    if (inst.parser === 'defuddle' && category === 'html') {
      const rendered = await safeRender(engine, finalUrl, remaining());
      const html = rendered?.html
        ?? (pre.body ? pre.body.toString('utf8') : '');
      return convertOutcome({
        finalUrl,
        contentType,
        status: rendered?.status || pre.status || 200,
        etag: rendered?.headers['etag'] ?? pre.etag,
        lastModified: rendered?.headers['last-modified'] ?? pre.lastModified,
        html,
      });
    }
    // parser raw or passthrough, or defuddle on non-html: return raw bytes.
    return rawOutcome({
      finalUrl, contentType, status: pre.status ?? 200,
      etag: pre.etag, lastModified: pre.lastModified,
      body: pre.body ?? Buffer.alloc(0),
    });
  }

  // Legacy path (no instruction): original hard-coded HTML branch.
  if (category !== 'html' || input.rawOnly) {
    return rawOutcome({
      finalUrl, contentType, status: pre.status ?? 200,
      etag: pre.etag, lastModified: pre.lastModified,
      body: pre.body ?? Buffer.alloc(0),
    });
  }

  const rendered = await safeRender(engine, finalUrl, remaining());
  const html = rendered?.html ?? (pre.body ? pre.body.toString('utf8') : '');
  return convertOutcome({
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
// usable response, convert (HTML) or return the bytes (non-HTML). Returns null
// when the navigation also fails, so the caller reports the original error.
async function renderFetch(
  engine: BrowserEngine, url: string, remainingMs: number,
): Promise<FetchOutcome | null> {
  const rendered = await safeRender(engine, url, remainingMs);
  if (!rendered || rendered.status >= 400) return null;
  const category = classifyContentType(rendered.contentType);
  if (category === 'html' || rendered.contentType === '') {
    return convertOutcome({
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
    return rawOutcome({
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

function rawOutcome(a: RawArgs): FetchOutcome {
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
    content: {
      ext: getFileExtension(a.contentType),
      raw: a.body.toString('base64'),
    },
  };
}

interface ConvertArgs {
  finalUrl: string; contentType: string; status: number;
  etag?: string; lastModified?: string; html: string;
}

async function convertOutcome(a: ConvertArgs): Promise<FetchOutcome> {
  const { markdown, meta } = await convertHtml(a.html, a.finalUrl);
  const sections = buildStructure(markdown);
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
    content: {
      ext: 'html',
      raw: Buffer.from(a.html, 'utf8').toString('base64'),
      markdown,
    },
  };
}
