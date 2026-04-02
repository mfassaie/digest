import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCachePath, getCacheDir, writeContent,
  writeCacheMeta, readCacheMeta, readMarkdown, readStructure, hasCacheEntry,
} from './cache.js';
import { getCacheRoot } from './config.js';
import type { CacheMeta, Section } from './types.js';

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

describe('writeContent', () => {
  const sections: Section[] = [
    { level: 1, title: 'T', slug: 't', startLine: 1, endLine: 2 },
  ];

  it('writes raw, markdown and structure, reporting names and sizes', async () => {
    const dir = getCacheDir('https://ex.com/doc', root);
    const written = await writeContent(dir, {
      ext: 'html',
      raw: Buffer.from('<html>hi</html>', 'utf8').toString('base64'),
      markdown: '# T\nBody.\n',
      sections,
    });
    expect(written.rawFile).toBe('raw.html');
    expect(written.markdownFile).toBe('content.md');
    expect(written.structureFile).toBe('structure.json');
    expect(written.rawSize).toBe(Buffer.byteLength('<html>hi</html>'));
    expect(written.markdownSize).toBe(Buffer.byteLength('# T\nBody.\n'));
    expect(await readMarkdown(dir)).toBe('# T\nBody.\n');
    expect(await readStructure(dir)).toEqual(sections);
  });

  it('writes only the raw file when there is no markdown', async () => {
    const dir = getCacheDir('https://ex.com/file', root);
    const written = await writeContent(dir, {
      ext: 'pdf',
      raw: Buffer.from('%PDF', 'utf8').toString('base64'),
      sections: [],
    });
    expect(written.rawFile).toBe('raw.pdf');
    expect(written.markdownFile).toBeUndefined();
    expect(written.structureFile).toBeUndefined();
    expect(written.markdownSize).toBeUndefined();
    expect(await readMarkdown(dir)).toBeNull();
  });
});
