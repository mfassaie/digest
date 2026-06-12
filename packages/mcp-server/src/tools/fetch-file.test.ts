import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtefactStore } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';
import type { ServerDeps } from '../deps.js';
import { handleFetchFile } from './fetch-file.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'digest-tff-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';

function mdServer(): typeof fetch {
  return async () => new Response('# Guide\n', {
    status: 200, headers: { 'content-type': 'text/markdown' },
  });
}

function deps(fetchImpl: typeof fetch = mdServer()): ServerDeps {
  return {
    store: createArtefactStore(root),
    settings: DEFAULT_SETTINGS,
    fetchImpl,
  };
}

describe('handleFetchFile', () => {
  it('returns the file Digest as JSON, including the stored path',
    async () => {
      const out = await handleFetchFile({ uri: MD_URL }, deps());
      expect(out.isError).toBeUndefined();
      const digest = JSON.parse(out.content[0].text) as {
        type: string;
        file: { name: string; uri: string; hash: string };
      };
      expect(digest.type).toBe('file');
      expect(digest.file.name).toBe('guide.md');
      // fetch_file is the only tool that returns file uris (design §4).
      expect(digest.file.uri).toContain('file://');
      expect(digest.file.hash).toMatch(/^sha256:/);
    });

  it('fetches local paths', async () => {
    const path = join(root, 'notes.md');
    await writeFile(path, '# Local\n', 'utf8');
    const out = await handleFetchFile(
      { uri: path },
      deps(async () => { throw new Error('no network'); }),
    );
    expect(out.isError).toBeUndefined();
    expect(out.content[0].text).toContain('notes.md');
  });

  it("rejects chunk_mode 'standard' cleanly until M8", async () => {
    const out = await handleFetchFile(
      { uri: MD_URL, chunk_mode: 'standard' }, deps(),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("chunk_mode 'standard'");
    expect(out.content[0].text).toContain('M8');
  });

  it("treats chunk_mode 'none' as the no-op it is", async () => {
    const out = await handleFetchFile(
      { uri: MD_URL, chunk_mode: 'none' }, deps(),
    );
    expect(out.isError).toBeUndefined();
  });

  it('names M9 when the rule needs the browser', async () => {
    const out = await handleFetchFile(
      { uri: 'https://ex.com/page' }, deps(),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('stealth browser');
    expect(out.content[0].text)
      .toContain('html/container support lands in M9');
  });

  it('reports cross-host redirects without isError', async () => {
    const redirecting: typeof fetch = async () => new Response(null, {
      status: 301, headers: { location: 'https://other.com/guide.md' },
    });
    const out = await handleFetchFile({ uri: MD_URL }, deps(redirecting));
    expect(out.isError).toBeUndefined();
    expect(out.content[0].text).toContain('Redirect detected');
    expect(out.content[0].text).toContain('https://other.com/guide.md');
  });

  it('maps pipeline errors to isError results', async () => {
    const notFound: typeof fetch = async () =>
      new Response('gone', { status: 404 });
    const out = await handleFetchFile({ uri: MD_URL }, deps(notFound));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('HTTP 404');
  });

  it('reports an invalid uri as a tool error', async () => {
    const out = await handleFetchFile({ uri: 'ftp://x/y.md' }, deps());
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('unsupported scheme');
  });
});
