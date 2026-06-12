import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkHealth, containerFetch } from './container-client.js';
import type { ContainerFetchRequest } from '@digest/shared';

const req: ContainerFetchRequest = {
  url: 'https://example.com',
  timeoutSeconds: 1,
  rawOnly: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('NFR-001: Timeout reliability', () => {
  it('returns fetch-failed within timeout + tolerance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException(
        'The operation was aborted', 'TimeoutError'
      )
    ));

    const start = Date.now();
    const result = await containerFetch(
      'http://127.0.0.1:1', req,
    );
    const elapsed = Date.now() - start;

    expect(result.outcome).toBe('fetch-failed');
    expect((result as { reason: string }).reason)
      .toContain('Timeout after 1 seconds');
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('containerFetch', () => {
  it('posts the request and returns the parsed outcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ outcome: 'http-error', status: 404 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await containerFetch('http://127.0.0.1:9', req);
    expect(result).toEqual({ outcome: 'http-error', status: 404 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9/fetch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      url: 'https://example.com', timeoutSeconds: 1,
    });
  });

  it('maps non-timeout network failures to fetch-failed with the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new Error('connection refused'),
    ));
    const result = await containerFetch('http://127.0.0.1:9', req);
    expect(result).toEqual({
      outcome: 'fetch-failed', reason: 'connection refused',
    });
  });
});

describe('checkHealth', () => {
  it('returns the parsed health payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({
        status: 'ok', cdpConnected: true, version: '0.2.0',
      }),
    }));
    const h = await checkHealth('http://127.0.0.1:9');
    expect(h.cdpConnected).toBe(true);
    expect(h.status).toBe('ok');
  });

  it('throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(checkHealth('http://127.0.0.1:9')).rejects.toThrow('down');
  });
});
