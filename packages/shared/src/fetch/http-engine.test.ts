import { describe, it, expect } from 'vitest';
import { httpFetch, type HttpFetchOutcome } from './http-engine.js';

// Drive the engine with a scripted fetch: each call shifts the next step.
type Step =
  | { status: number; headers?: Record<string, string>; body?: string }
  | { reject: Error };

function scripted(steps: Step[], seen: { url: string; headers: Headers }[] = []) {
  const queue = [...steps];
  const fetchImpl: typeof fetch = (input, init) => {
    seen.push({
      url: String(input),
      headers: new Headers(init?.headers as Record<string, string>),
    });
    const step = queue.shift();
    if (step === undefined) throw new Error('scripted fetch exhausted');
    if ('reject' in step) return Promise.reject(step.reject);
    return Promise.resolve(new Response(
      step.body === undefined || step.status === 304 ? null : step.body,
      { status: step.status, headers: step.headers },
    ));
  };
  return { fetchImpl, seen };
}

function request(url = 'https://ex.com/a.md', extra = {}) {
  return { url, timeoutSeconds: 5, ...extra };
}

describe('httpFetch', () => {
  it('returns bytes, type and validators on a 200', async () => {
    const { fetchImpl } = scripted([{
      status: 200,
      body: '# hi',
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        etag: 'W/"v1"',
        'last-modified': 'Tue, 01 Jan 2026 00:00:00 GMT',
      },
    }]);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out.outcome).toBe('fetched');
    const fetched = out as Extract<HttpFetchOutcome, { outcome: 'fetched' }>;
    expect(Buffer.from(fetched.bytes).toString('utf8')).toBe('# hi');
    expect(fetched.contentType).toBe('text/markdown; charset=utf-8');
    expect(fetched.etag).toBe('W/"v1"');
    expect(fetched.lastModified).toBe('Tue, 01 Jan 2026 00:00:00 GMT');
    expect(fetched.finalUrl).toBe('https://ex.com/a.md');
  });

  it('follows same-host redirects and reports the final url', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const { fetchImpl } = scripted([
      { status: 301, headers: { location: '/moved.md' } },
      { status: 302, headers: { location: 'https://ex.com/final.md' } },
      { status: 200, body: 'done' },
    ], seen);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out.outcome).toBe('fetched');
    expect((out as { finalUrl: string }).finalUrl)
      .toBe('https://ex.com/final.md');
    expect(seen.map((s) => s.url)).toEqual([
      'https://ex.com/a.md',
      'https://ex.com/moved.md',
      'https://ex.com/final.md',
    ]);
  });

  it('reports a cross-host redirect instead of following it', async () => {
    const { fetchImpl } = scripted([
      { status: 308, headers: { location: 'https://other.com/a.md' } },
    ]);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out).toEqual({
      outcome: 'cross-host-redirect',
      fromUrl: 'https://ex.com/a.md',
      toUrl: 'https://other.com/a.md',
    });
  });

  it('fails after more than maxRedirects same-host hops', async () => {
    const hops = Array.from({ length: 7 }, () => (
      { status: 302, headers: { location: '/loop.md' } }
    ));
    const { fetchImpl } = scripted(hops);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out.outcome).toBe('fetch-failed');
    expect((out as { reason: string }).reason).toContain('too many redirects');
  });

  it('treats a redirect without a location as an http error', async () => {
    const { fetchImpl } = scripted([{ status: 301 }]);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out).toEqual({ outcome: 'http-error', status: 301 });
  });

  it('reports an invalid redirect location', async () => {
    const { fetchImpl } = scripted([
      { status: 302, headers: { location: 'https://' } },
    ]);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out.outcome).toBe('fetch-failed');
    expect((out as { reason: string }).reason)
      .toContain('invalid redirect location');
  });

  it('sends validators and maps 304 to not-modified', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const { fetchImpl } = scripted([{ status: 304 }], seen);
    const out = await httpFetch(request('https://ex.com/a.md', {
      validators: {
        etag: 'W/"v1"',
        lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT',
      },
    }), { fetchImpl });
    expect(out).toEqual({ outcome: 'not-modified' });
    expect(seen[0].headers.get('if-none-match')).toBe('W/"v1"');
    expect(seen[0].headers.get('if-modified-since'))
      .toBe('Tue, 01 Jan 2026 00:00:00 GMT');
  });

  it('sends no conditional headers without validators', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const { fetchImpl } = scripted([{ status: 200, body: 'x' }], seen);
    await httpFetch(request(), { fetchImpl });
    expect(seen[0].headers.get('if-none-match')).toBeNull();
    expect(seen[0].headers.get('if-modified-since')).toBeNull();
  });

  it('maps 4xx/5xx to http-error', async () => {
    const { fetchImpl } = scripted([{ status: 503 }]);
    const out = await httpFetch(request(), { fetchImpl });
    expect(out).toEqual({ outcome: 'http-error', status: 503 });
  });

  it('does not retry a definitive http error', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const { fetchImpl } = scripted([{ status: 500 }], seen);
    const out = await httpFetch(
      request('https://ex.com/a.md', { retries: 3 }), { fetchImpl },
    );
    expect(out).toEqual({ outcome: 'http-error', status: 500 });
    expect(seen).toHaveLength(1);
  });

  it('retries a network failure within the retry budget', async () => {
    const { fetchImpl } = scripted([
      { reject: new TypeError('fetch failed') },
      { status: 200, body: 'second try' },
    ]);
    const out = await httpFetch(
      request('https://ex.com/a.md', { retries: 1 }), { fetchImpl },
    );
    expect(out.outcome).toBe('fetched');
  });

  it('reports fetch-failed with the cause code after retries run out',
    async () => {
      const err = new TypeError('fetch failed');
      (err as { cause?: unknown }).cause = { code: 'ECONNRESET' };
      const { fetchImpl } = scripted([{ reject: err }]);
      const out = await httpFetch(request(), { fetchImpl });
      expect(out).toEqual({
        outcome: 'fetch-failed',
        reason: 'fetch failed (ECONNRESET)',
      });
    });

  it('reports timeout when the budget expires mid redirect loop',
    async () => {
      const slowRedirect: typeof fetch = async () => {
        await new Promise((r) => setTimeout(r, 60));
        return new Response(null, {
          status: 302, headers: { location: '/next.md' },
        });
      };
      const out = await httpFetch(
        { url: 'https://ex.com/a.md', timeoutSeconds: 0.03 },
        { fetchImpl: slowRedirect },
      );
      expect(out).toEqual({ outcome: 'timeout' });
    });

  it('maps an abort during the body read to timeout', async () => {
    const abortingBody: typeof fetch = async () => {
      const err = new DOMException('aborted', 'AbortError');
      return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.reject(err),
      } as unknown as Response;
    };
    const out = await httpFetch(request(), { fetchImpl: abortingBody });
    expect(out).toEqual({ outcome: 'timeout' });
  });

  it('reports an unparsable request url as fetch-failed', async () => {
    const { fetchImpl } = scripted([]);
    const out = await httpFetch(request('not a url'), { fetchImpl });
    expect(out.outcome).toBe('fetch-failed');
    expect((out as { reason: string }).reason).toContain('invalid URL');
  });
});
