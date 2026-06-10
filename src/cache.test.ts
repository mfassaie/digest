import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCachePath, getCacheDir, getCacheRoot,
  writeCacheMeta, readCacheMeta, readMarkdown, readStructure, hasCacheEntry,
} from './cache.js';
import type { CacheMeta } from './types.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'falk-cache-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('cache paths', () => {
  it('getCachePath is <host>/<sha256> and stable', () => {
    const p = getCachePath('https://example.com/a?b=1');
    expect(p).toMatch(/^example\.com\/[a-f0-9]{64}$/);
    expect(getCachePath('https://example.com/a?b=1')).toBe(p);
  });
  it('different urls hash differently', () => {
    expect(getCachePath('https://example.com/a'))
      .not.toBe(getCachePath('https://example.com/b'));
  });
  it('default root is under .claude/digest', () => {
    expect(getCacheRoot().replace(/\\/g, '/'))
      .toContain('.claude/digest/cache');
  });
});

describe('meta round-trip', () => {
  const meta: CacheMeta = {
    cacheVersion: 2, url: 'https://ex.com', finalUrl: 'https://ex.com',
    contentType: 'text/html', category: 'html', converter: 'defuddle',
    fetchedAt: 'now', rawFile: 'raw.html', markdownFile: 'content.md',
  };
  it('writes and reads meta', async () => {
    const dir = getCacheDir('https://ex.com', root);
    await writeCacheMeta(dir, meta);
    expect(await readCacheMeta(dir)).toEqual(meta);
    expect(await hasCacheEntry('https://ex.com', root)).toBe(true);
  });
  it('returns null for missing meta/markdown/structure', async () => {
    const dir = getCacheDir('https://nope.com', root);
    expect(await readCacheMeta(dir)).toBeNull();
    expect(await readMarkdown(dir)).toBeNull();
    expect(await readStructure(dir)).toBeNull();
    expect(await hasCacheEntry('https://nope.com', root)).toBe(false);
  });
});
