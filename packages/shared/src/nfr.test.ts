import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCacheDir, writeCacheMeta, readCacheMeta } from './cache.js';
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
