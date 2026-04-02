import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCacheDir, writeCacheMeta, readCacheMeta } from './cache.js';
import { httpFetch } from './fetch/http-engine.js';
import type { CacheMeta } from './types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wfp-nfr-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('NFR-002: Cache I/O performance', () => {
  it('read/write under 100ms', async () => {
    const url = 'https://example.com/large';
    const dir = getCacheDir(url, tempDir);
    const meta: CacheMeta = {
      cacheVersion: 2,
      url,
      finalUrl: url,
      contentType: 'text/html',
      category: 'html',
      converter: 'defuddle',
      fetchedAt: new Date().toISOString(),
      rawFile: 'raw.html',
      markdownFile: 'content.md',
    };

    const writeStart = Date.now();
    await writeCacheMeta(dir, meta);
    const writeElapsed = Date.now() - writeStart;
    expect(writeElapsed).toBeLessThan(100);

    const readStart = Date.now();
    const result = await readCacheMeta(dir);
    const readElapsed = Date.now() - readStart;
    expect(readElapsed).toBeLessThan(100);
    expect(result).not.toBeNull();
  });
});

// Plan M4: the no-hang guarantee extends to the local engine (design
// §4.8) — a request that never returns is aborted at the deadline, so the
// MCP server cannot hang even without the container's host-side abort.
describe('NFR-001: no-hang guarantee (local http engine)', () => {
  it('aborts a hung request when the deadline fires', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort', () => reject(init.signal!.reason),
        );
      });
    const started = Date.now();
    const out = await httpFetch(
      { url: 'https://example.com/hang', timeoutSeconds: 0.2 },
      { fetchImpl: hang },
    );
    expect(out.outcome).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a hung retry still ends inside the original budget', async () => {
    let calls = 0;
    const failThenHang: typeof fetch = (_input, init) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort', () => reject(init.signal!.reason),
        );
      });
    };
    const out = await httpFetch(
      { url: 'https://example.com/hang', timeoutSeconds: 0.2, retries: 2 },
      { fetchImpl: failThenHang },
    );
    expect(out.outcome).toBe('timeout');
    expect(calls).toBe(2);
  });
});
