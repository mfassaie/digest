import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BrowserEngine, PreflightResponse, RenderResult,
} from './engine.js';
import { orchestrateFetch, type FetchInput } from './fetch-orchestrator.js';

interface Hop {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

// Scriptable fake: request() consumes queued hops in order; render() returns
// a fixed rendered DOM.
class FakeEngine implements BrowserEngine {
  requests: string[] = [];
  rendered = false;
  constructor(
    private hops: Hop[],
    private renderResult?: Partial<RenderResult>,
  ) {}

  async request(url: string): Promise<PreflightResponse> {
    this.requests.push(url);
    const hop = this.hops.shift();
    if (!hop) throw new Error('no more hops queued');
    return {
      status: hop.status,
      headers: hop.headers ?? {},
      body: async () => Buffer.from(hop.body ?? '', 'utf8'),
    };
  }

  async render(url: string): Promise<RenderResult> {
    this.rendered = true;
    return {
      finalUrl: this.renderResult?.finalUrl ?? url,
      status: this.renderResult?.status ?? 200,
      contentType: this.renderResult?.contentType ?? 'text/html',
      html: this.renderResult?.html
        ?? '<html><body><main><h1>Rendered</h1>'
          + '<p>Body content here for the page.</p></main></body></html>',
    };
  }
}

let dataRoot: string;
beforeEach(() => { dataRoot = mkdtempSync(join(tmpdir(), 'falk-orch-')); });
afterEach(() => { rmSync(dataRoot, { recursive: true, force: true }); });

const base: Omit<FetchInput, 'url'> = {
  cachePath: 'example.com/hash',
  timeoutSeconds: 30,
  rawOnly: false,
};

describe('orchestrateFetch', () => {
  it('renders and converts HTML, writing md + structure', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<raw>' },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/page',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(true);
    expect(out.category).toBe('html');
    expect(out.files.markdown).toBe('content.md');
    expect(out.files.structure).toBe('structure.json');
    expect(out.sections.length).toBeGreaterThan(0);
    const dir = join(dataRoot, base.cachePath);
    expect(existsSync(join(dir, 'content.md'))).toBe(true);
    expect(readFileSync(join(dir, 'content.md'), 'utf8')).toContain('Rendered');
  });

  it('saves non-HTML as raw and does not render', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'application/pdf' },
        body: '%PDF-1.7 data' },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/file.pdf',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(false);
    expect(out.category).toBe('binary');
    expect(out.files.raw).toBe('raw.pdf');
    expect(out.files.markdown).toBeUndefined();
    expect(existsSync(join(dataRoot, base.cachePath, 'raw.pdf'))).toBe(true);
  });

  it('honours raw_only for HTML (no render, no markdown)', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'text/html' },
        body: '<html><body>raw html</body></html>' },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/page', rawOnly: true,
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(false);
    expect(out.files.raw).toBe('raw.html');
    expect(out.files.markdown).toBeUndefined();
  });

  it('follows same-host redirects', async () => {
    const engine = new FakeEngine([
      { status: 301, headers: { location: 'https://example.com/final' } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: 'x' },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/start',
    });
    expect(out.outcome).toBe('fetched');
    expect(engine.requests).toEqual([
      'https://example.com/start', 'https://example.com/final',
    ]);
  });

  it('reports cross-host redirects without following', async () => {
    const engine = new FakeEngine([
      { status: 302, headers: { location: 'https://other.com/x' } },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/start',
    });
    expect(out.outcome).toBe('cross-host-redirect');
    if (out.outcome !== 'cross-host-redirect') return;
    expect(out.toUrl).toBe('https://other.com/x');
  });

  it('returns not-modified on 304', async () => {
    const engine = new FakeEngine([{ status: 304 }]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/page',
      validators: { etag: 'abc' },
    });
    expect(out.outcome).toBe('not-modified');
  });

  it('returns http-error on 4xx/5xx', async () => {
    const engine = new FakeEngine([{ status: 404 }]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/missing',
    });
    expect(out.outcome).toBe('http-error');
    if (out.outcome !== 'http-error') return;
    expect(out.status).toBe(404);
  });

  it('falls back to preflight body if render fails', async () => {
    class FailRender extends FakeEngine {
      async render(): Promise<RenderResult> {
        throw new Error('render boom');
      }
    }
    const engine = new FailRender([
      { status: 200, headers: { 'content-type': 'text/html' },
        body: '<html><body><main><h1>Fallback</h1>'
          + '<p>Static body.</p></main></body></html>' },
    ]);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/page',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    const md = readFileSync(
      join(dataRoot, base.cachePath, 'content.md'), 'utf8',
    );
    expect(md).toContain('Fallback');
  });

  it('reports fetch-failed when too many redirects', async () => {
    const hops: Hop[] = [];
    for (let i = 0; i < 7; i++) {
      hops.push({
        status: 301, headers: { location: `https://example.com/r${i}` },
      });
    }
    const engine = new FakeEngine(hops);
    const out = await orchestrateFetch(engine, dataRoot, {
      ...base, url: 'https://example.com/start',
    });
    expect(out.outcome).toBe('fetch-failed');
  });
});
