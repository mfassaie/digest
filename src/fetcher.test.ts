import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normaliseUrl,
  fetchWithTimeout,
  fetchWithRedirects,
} from './fetcher.js';

describe('normaliseUrl', () => {
  it('upgrades http to https', () => {
    expect(normaliseUrl('http://example.com'))
      .toBe('https://example.com/');
  });

  it('leaves https unchanged', () => {
    expect(normaliseUrl('https://example.com'))
      .toBe('https://example.com/');
  });

  it('preserves path and query', () => {
    expect(normaliseUrl('http://example.com/path?q=1'))
      .toBe('https://example.com/path?q=1');
  });

  it('preserves explicit ports', () => {
    expect(normaliseUrl('http://example.com:8080/'))
      .toBe('https://example.com:8080/');
  });
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns FetchResult on success', async () => {
    const html = '<html><body>hello</body></html>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ));

    const result = await fetchWithTimeout(
      'https://example.com', 30
    );
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/html');
    expect(result.body.toString()).toBe(html);
    expect(result.url).toBe('https://example.com');
  });

  it('sets User-Agent header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    ));

    await fetchWithTimeout('https://example.com', 30);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers['User-Agent']).toContain('Claude-User');
  });

  it('uses redirect manual mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    ));

    await fetchWithTimeout('https://example.com', 30);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].redirect).toBe('manual');
  });

  it('throws on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted', 'TimeoutError')
    ));

    await expect(
      fetchWithTimeout('https://example.com', 1)
    ).rejects.toThrow();
  });
});

describe('fetchWithRedirects', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns content for non-redirect response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('hello', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ));

    const result = await fetchWithRedirects(
      'https://example.com', 30
    );
    expect(result.type).toBe('content');
  });

  it('detects cross-host redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', {
        status: 301,
        headers: { Location: 'https://other.com/page' },
      }),
    ));

    const result = await fetchWithRedirects(
      'https://example.com/page', 30
    );
    expect(result.type).toBe('cross-host');
    if (result.type === 'cross-host') {
      expect(result.fromUrl).toBe('https://example.com/page');
      expect(result.toUrl).toBe('https://other.com/page');
    }
  });

  it('follows same-host redirect', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { Location: 'https://example.com/new' },
      }))
      .mockResolvedValueOnce(new Response('final', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchWithRedirects(
      'https://example.com/old', 30
    );
    expect(result.type).toBe('content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('follows chain of same-host redirects', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 301,
        headers: { Location: 'https://example.com/b' },
      }))
      .mockResolvedValueOnce(new Response('', {
        status: 302,
        headers: { Location: 'https://example.com/c' },
      }))
      .mockResolvedValueOnce(new Response('final', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchWithRedirects(
      'https://example.com/a', 30
    );
    expect(result.type).toBe('content');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws on too many redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('', {
        status: 301,
        headers: { Location: 'https://example.com/loop' },
      }))
    ));

    await expect(
      fetchWithRedirects('https://example.com/start', 30)
    ).rejects.toThrow(/Too many redirects/);
  });
});
