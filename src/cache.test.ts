import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CacheMeta } from './types.js';
import {
  getCacheDir,
  writeCacheEntry,
  readCacheMeta,
  hasCacheEntry,
} from './cache.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wfp-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('getCacheDir', () => {
  it('returns consistent path for same URL', () => {
    const a = getCacheDir('https://example.com/page', tempDir);
    const b = getCacheDir('https://example.com/page', tempDir);
    expect(a).toBe(b);
  });

  it('returns different paths for different URLs', () => {
    const a = getCacheDir('https://example.com/a', tempDir);
    const b = getCacheDir('https://example.com/b', tempDir);
    expect(a).not.toBe(b);
  });

  it('uses domain in path', () => {
    const dir = getCacheDir(
      'https://example.com/page', tempDir
    );
    expect(dir).toContain('example.com');
  });
});

describe('writeCacheEntry', () => {
  it('writes meta.json', async () => {
    const dir = getCacheDir(
      'https://example.com/test', tempDir
    );
    const meta: CacheMeta = {
      url: 'https://example.com/test',
      contentType: 'text/html',
      fetchedAt: new Date().toISOString(),
    };
    await writeCacheEntry(
      dir, meta, Buffer.from('<html>'), 'html'
    );

    const read = await readCacheMeta(dir);
    expect(read).not.toBeNull();
    expect(read!.url).toBe('https://example.com/test');
  });

  it('writes raw file and markdown file', async () => {
    const dir = getCacheDir(
      'https://example.com/md', tempDir
    );
    const meta: CacheMeta = {
      url: 'https://example.com/md',
      contentType: 'text/html',
      fetchedAt: new Date().toISOString(),
    };
    const { rawFile, markdownFile } = await writeCacheEntry(
      dir, meta,
      Buffer.from('<html>hello</html>'), 'html',
      '# Hello',
    );

    expect(rawFile).toContain('raw.html');
    expect(markdownFile).toContain('content.md');
  });

  it('omits markdown file when not provided', async () => {
    const dir = getCacheDir(
      'https://example.com/bin', tempDir
    );
    const meta: CacheMeta = {
      url: 'https://example.com/bin',
      contentType: 'application/pdf',
      fetchedAt: new Date().toISOString(),
    };
    const { markdownFile } = await writeCacheEntry(
      dir, meta, Buffer.from('pdf-data'), 'pdf'
    );

    expect(markdownFile).toBeUndefined();
  });
});

describe('readCacheMeta', () => {
  it('returns null for non-existent entry', async () => {
    const result = await readCacheMeta(
      join(tempDir, 'nonexistent')
    );
    expect(result).toBeNull();
  });
});

describe('hasCacheEntry', () => {
  it('returns false for uncached URL', async () => {
    const result = await hasCacheEntry(
      'https://example.com/missing', tempDir
    );
    expect(result).toBe(false);
  });

  it('returns true after writing cache entry', async () => {
    const url = 'https://example.com/cached';
    const dir = getCacheDir(url, tempDir);
    const meta: CacheMeta = {
      url,
      contentType: 'text/html',
      fetchedAt: new Date().toISOString(),
    };
    await writeCacheEntry(
      dir, meta, Buffer.from('data'), 'html'
    );

    const result = await hasCacheEntry(url, tempDir);
    expect(result).toBe(true);
  });
});
