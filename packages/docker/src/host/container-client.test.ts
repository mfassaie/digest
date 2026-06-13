import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkHealth, containerFetch, checkMinVersion, compareSemver,
  MIN_SERVICE_VERSION,
} from './container-client.js';
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

describe('compareSemver', () => {
  it('equals returns 0', () => {
    expect(compareSemver('0.3.0', '0.3.0')).toBe(0);
  });
  it('greater returns positive', () => {
    expect(compareSemver('0.4.0', '0.3.0')).toBeGreaterThan(0);
  });
  it('lesser returns negative', () => {
    expect(compareSemver('0.2.0', '0.3.0')).toBeLessThan(0);
  });
  it('handles patch version differences', () => {
    expect(compareSemver('0.3.1', '0.3.0')).toBeGreaterThan(0);
  });
  it('handles major version differences', () => {
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
  });
});

describe('checkMinVersion', () => {
  it('returns null when version meets minimum', () => {
    expect(checkMinVersion({
      status: 'ok', cdpConnected: true, version: MIN_SERVICE_VERSION,
    })).toBeNull();
  });
  it('returns null when version exceeds minimum', () => {
    expect(checkMinVersion({
      status: 'ok', cdpConnected: true, version: '1.0.0',
    })).toBeNull();
  });
  it('returns a hint string when version is too old', () => {
    const hint = checkMinVersion({
      status: 'ok', cdpConnected: true, version: '0.2.0',
    });
    expect(hint).toContain('npx digest setup');
    expect(hint).toContain('0.2.0');
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
