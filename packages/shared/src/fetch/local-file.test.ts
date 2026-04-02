import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  classifyResource, mimeForFileName, readLocalFile,
} from './local-file.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'digest-local-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('classifyResource', () => {
  it('normalises web urls and upgrades http to https', () => {
    expect(classifyResource('http://Ex.com/A.md')).toEqual({
      kind: 'web', url: 'https://ex.com/A.md',
    });
  });

  it('keeps https urls as web resources', () => {
    expect(classifyResource('https://ex.com/docs/guide.md').kind)
      .toBe('web');
  });

  it('canonicalises a plain path to its absolute file url', () => {
    const path = join(dir, 'notes.md');
    const out = classifyResource(path);
    expect(out).toEqual({
      kind: 'file', url: pathToFileURL(path).href, path,
    });
  });

  it('resolves a relative path against the cwd', () => {
    const out = classifyResource('README.md');
    expect(out.kind).toBe('file');
    expect((out as { path: string }).path)
      .toBe(join(process.cwd(), 'README.md'));
  });

  it('accepts file:// urls', () => {
    const path = join(dir, 'a.md');
    const out = classifyResource(pathToFileURL(path).href);
    expect(out.kind).toBe('file');
    expect((out as { path: string }).path).toBe(path);
  });

  it('treats a Windows drive spelling as a path, not a scheme', () => {
    const out = classifyResource('C:\\docs\\a.md');
    expect(out.kind).toBe('file');
  });

  it('rejects unsupported schemes', () => {
    const out = classifyResource('ftp://ex.com/a.md');
    expect(out.kind).toBe('invalid');
    expect((out as { reason: string }).reason)
      .toContain('unsupported scheme');
  });

  it('rejects a malformed uri with an explicit scheme', () => {
    const out = classifyResource('https://');
    expect(out.kind).toBe('invalid');
    expect((out as { reason: string }).reason).toContain('invalid URL');
  });
});

describe('mimeForFileName', () => {
  it('derives the type from the extension', () => {
    expect(mimeForFileName('guide.md')).toBe('text/markdown');
    expect(mimeForFileName('page.html')).toBe('text/html');
    expect(mimeForFileName('doc.pdf')).toBe('application/pdf');
  });

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(mimeForFileName('archive.tar.xz')).toBe(
      'application/octet-stream',
    );
    expect(mimeForFileName('LICENSE')).toBe('application/octet-stream');
  });
});

describe('readLocalFile', () => {
  it('reads bytes, name and mime', async () => {
    const path = join(dir, 'notes.md');
    await writeFile(path, '# Notes\n', 'utf8');
    const out = await readLocalFile(path);
    expect(out.name).toBe('notes.md');
    expect(out.mimeType).toBe('text/markdown');
    expect(Buffer.from(out.bytes).toString('utf8')).toBe('# Notes\n');
  });

  it('errors cleanly on a missing file', async () => {
    await expect(readLocalFile(join(dir, 'gone.md')))
      .rejects.toThrow('cannot read local file');
  });

  it('errors cleanly on a directory', async () => {
    await expect(readLocalFile(dir)).rejects.toThrow('not a file');
  });
});
