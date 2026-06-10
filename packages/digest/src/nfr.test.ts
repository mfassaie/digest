import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { containerFetch } from './container-client.js';
import {
  getCacheDir,
  writeCacheMeta,
  readCacheMeta,
} from './cache.js';
import type { CacheMeta, ContainerFetchRequest } from './types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wfp-nfr-'));
  vi.restoreAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('NFR-001: Timeout reliability', () => {
  it('returns fetch-failed within timeout + tolerance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException(
        'The operation was aborted', 'TimeoutError'
      )
    ));

    const req: ContainerFetchRequest = {
      url: 'https://example.com',
      cachePath: 'example.com/abc',
      timeoutSeconds: 1,
    };

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
