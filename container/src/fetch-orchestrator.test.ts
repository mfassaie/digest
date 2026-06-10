import { describe, it, expect } from 'vitest';
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
      headers: this.renderResult?.headers ?? {},
      html: this.renderResult?.html
        ?? '<html><body><main><h1>Rendered</h1>'
          + '<p>Body content here for the page.</p></main></body></html>',
    };
  }
}

const base: Omit<FetchInput, 'url'> = {
  timeoutSeconds: 30,
  rawOnly: false,
};

// Decode the returned base64 raw into a utf8 string for assertions.
function rawText(raw: string): string {
  return Buffer.from(raw, 'base64').toString('utf8');
}

describe('orchestrateFetch', () => {
  it('renders and converts HTML, returning markdown + structure', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<raw>' },
    ]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/page',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(true);
    expect(out.category).toBe('html');
    expect(out.content.ext).toBe('html');
    expect(out.content.markdown).toContain('Rendered');
    expect(out.sections.length).toBeGreaterThan(0);
    expect(rawText(out.content.raw)).toContain('Rendered');
  });

  it('returns non-HTML as raw and does not render', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'application/pdf' },
        body: '%PDF-1.7 data' },
    ]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/file.pdf',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(false);
    expect(out.category).toBe('binary');
    expect(out.content.ext).toBe('pdf');
    expect(out.content.markdown).toBeUndefined();
    expect(rawText(out.content.raw)).toContain('%PDF-1.7');
  });

  it('honours raw_only for HTML (no render, no markdown)', async () => {
    const engine = new FakeEngine([
      { status: 200, headers: { 'content-type': 'text/html' },
        body: '<html><body>raw html</body></html>' },
    ]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/page', rawOnly: true,
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(engine.rendered).toBe(false);
    expect(out.content.ext).toBe('html');
    expect(out.content.markdown).toBeUndefined();
    expect(rawText(out.content.raw)).toContain('raw html');
  });

  it('follows same-host redirects', async () => {
    const engine = new FakeEngine([
      { status: 301, headers: { location: 'https://example.com/final' } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: 'x' },
    ]);
    const out = await orchestrateFetch(engine, {
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
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/start',
    });
    expect(out.outcome).toBe('cross-host-redirect');
    if (out.outcome !== 'cross-host-redirect') return;
    expect(out.toUrl).toBe('https://other.com/x');
  });

  it('returns not-modified on 304', async () => {
    const engine = new FakeEngine([{ status: 304 }]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/page',
      validators: { etag: 'abc' },
    });
    expect(out.outcome).toBe('not-modified');
  });

  it('returns http-error on 4xx/5xx', async () => {
    const engine = new FakeEngine([{ status: 404 }]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/missing',
    });
    expect(out.outcome).toBe('http-error');
    if (out.outcome !== 'http-error') return;
    expect(out.status).toBe(404);
  });

  it('does not escalate a plain 404 to the browser', async () => {
    const engine = new FakeEngine([{ status: 404 }]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/missing',
    });
    expect(engine.rendered).toBe(false);
    expect(out.outcome).toBe('http-error');
  });

  it('escalates a bot-block status (402) to a stealth render', async () => {
    // Plain pre-flight is blocked; the stealth browser succeeds.
    const engine = new FakeEngine([{ status: 402 }], {
      contentType: 'text/html',
      html: '<html><body><main><h1>Unblocked</h1>'
        + '<p>Real content after stealth navigation.</p></main></body></html>',
    });
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://stackoverflow.com/q/1',
    });
    expect(engine.rendered).toBe(true);
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(out.content.markdown).toContain('Unblocked');
  });

  it('does not escalate a bot-block status when raw_only', async () => {
    const engine = new FakeEngine([{ status: 403 }]);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/p', rawOnly: true,
    });
    expect(engine.rendered).toBe(false);
    expect(out.outcome).toBe('http-error');
  });

  it('reports the original error when the stealth render also fails', async () => {
    // 403 pre-flight, and the render returns 403 too.
    const engine = new FakeEngine([{ status: 403 }], { status: 403 });
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/blocked',
    });
    expect(engine.rendered).toBe(true);
    expect(out.outcome).toBe('http-error');
    if (out.outcome !== 'http-error') return;
    expect(out.status).toBe(403);
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
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/page',
    });
    expect(out.outcome).toBe('fetched');
    if (out.outcome !== 'fetched') return;
    expect(out.content.markdown).toContain('Fallback');
  });

  it('reports fetch-failed when too many redirects', async () => {
    const hops: Hop[] = [];
    for (let i = 0; i < 7; i++) {
      hops.push({
        status: 301, headers: { location: `https://example.com/r${i}` },
      });
    }
    const engine = new FakeEngine(hops);
    const out = await orchestrateFetch(engine, {
      ...base, url: 'https://example.com/start',
    });
    expect(out.outcome).toBe('fetch-failed');
  });
});
