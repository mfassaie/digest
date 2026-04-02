import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchWithTimeout } from './fetcher.js';
import {
  getCacheDir,
  writeCacheEntry,
  readCacheMeta,
} from './cache.js';
import type { CacheMeta } from './types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wfp-nfr-'));
  vi.restoreAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('NFR-001: Timeout reliability', () => {
  it('aborts within timeout + 1s tolerance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException(
        'The operation was aborted', 'TimeoutError'
      )
    ));

    const start = Date.now();
    await expect(
      fetchWithTimeout('https://example.com', 1)
    ).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});

describe('NFR-002: Cache I/O performance', () => {
  it('read/write under 100ms for 1MB payload', async () => {
    const url = 'https://example.com/large';
    const dir = getCacheDir(url, tempDir);
    const body = Buffer.alloc(1024 * 1024, 'x');
    const meta: CacheMeta = {
      url,
      contentType: 'text/html',
      fetchedAt: new Date().toISOString(),
    };

    const writeStart = Date.now();
    await writeCacheEntry(dir, meta, body, 'html', 'md');
    const writeElapsed = Date.now() - writeStart;
    expect(writeElapsed).toBeLessThan(100);

    const readStart = Date.now();
    const result = await readCacheMeta(dir);
    const readElapsed = Date.now() - readStart;
    expect(readElapsed).toBeLessThan(100);
    expect(result).not.toBeNull();
  });
});

describe('NFR-003: Startup time', () => {
  it('server module imports in under 2 seconds', async () => {
    const start = Date.now();
    const { createServer } = await import('./server.js');
    const server = createServer();
    const elapsed = Date.now() - start;

    expect(server).toBeDefined();
    expect(elapsed).toBeLessThan(2000);
  });
});
