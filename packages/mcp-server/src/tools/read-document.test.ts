import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artefactId, createArtefactStore,
} from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';
import type { ServerDeps } from '../deps.js';
import { handleFetchFile } from './fetch-file.js';
import { handleReadDocument } from './read-document.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'digest-trd-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';
const MD = [
  '# Guide', '', 'Intro paragraph about the guide.', '',
  '## Install', '', 'Run the installer.', '',
].join('\n');

function server(body: string, mime = 'text/markdown'): typeof fetch {
  return async () => new Response(body, {
    status: 200, headers: { 'content-type': mime },
  });
}

function deps(fetchImpl: typeof fetch = server(MD)): ServerDeps {
  return {
    store: createArtefactStore(root),
    settings: DEFAULT_SETTINGS,
    fetchImpl,
  };
}

// Every key (and string value) in the response, recursively — used to
// prove the no-uris guarantee structurally, not by substring luck.
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, keys);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
}

describe('handleReadDocument', () => {
  it('serves the document Digest with a section tree and zero uris',
    async () => {
      const d = deps();
      await handleFetchFile({ uri: MD_URL }, d);
      const out = await handleReadDocument({ resource: MD_URL }, d);
      expect(out.isError).toBeUndefined();
      const body = JSON.parse(out.content[0].text) as Record<string, unknown>;
      expect(body.type).toBe('document');
      expect(body.source_changed).toBe(false);
      const document = body.document as {
        name: string; summary?: string; keywords?: string[];
        sections: {
          type: string;
          children?: { title?: string; content?: unknown }[];
        };
      };
      expect(document.name).toBe('Guide');
      expect(document.summary).toBeTruthy();
      expect(document.sections.type).toBe('root');
      expect(document.sections.children?.[0].title).toBe('Guide');
      // The tree is the toc: no content arrays (design §5.4).
      const keys = new Set<string>();
      collectKeys(body, keys);
      expect(keys.has('content')).toBe(false);
      expect(keys.has('value')).toBe(false);
      // Zero uris anywhere in the response (plan M4).
      expect(keys.has('uri')).toBe(false);
      expect(keys.has('origin_uri')).toBe(false);
      expect(out.content[0].text).not.toContain('file://');
      // File identity stays: hash/mime/size (§10.10).
      const file = body.file as Record<string, unknown>;
      expect(file.hash).toMatch(/^sha256:/);
      expect(file.mime_type).toBe('text/markdown');
      expect(typeof file.size_bytes).toBe('number');
    });

  it('hops converted_to when given the file artefact id', async () => {
    const d = deps();
    await handleFetchFile({ uri: MD_URL }, d);
    await handleReadDocument({ resource: MD_URL }, d);
    const out = await handleReadDocument(
      { resource: artefactId(MD_URL, 'file') }, d,
    );
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      id: string; type: string;
    };
    expect(body.type).toBe('document');
    expect(body.id).toBe(artefactId(MD_URL, 'document'));
  });

  it('meta_only drops the tree, sections_only drops the extracts',
    async () => {
      const d = deps();
      const meta = JSON.parse((await handleReadDocument(
        { resource: MD_URL, read_mode: 'meta_only' }, d,
      )).content[0].text) as { document: Record<string, unknown> };
      expect(meta.document.sections).toBeUndefined();
      expect(meta.document.summary).toBeTruthy();

      const sections = JSON.parse((await handleReadDocument(
        { resource: MD_URL, read_mode: 'sections_only' }, d,
      )).content[0].text) as { document: Record<string, unknown> };
      expect(sections.document.sections).toBeTruthy();
      expect(sections.document.summary).toBeUndefined();
      expect(sections.document.keywords).toBeUndefined();
    });

  it('refuses non-md sources with a clean error naming the roadmap',
    async () => {
      const out = await handleReadDocument(
        { resource: 'https://ex.com/report.pdf' }, deps(),
      );
      expect(out.isError).toBe(true);
      const message = out.content[0].text;
      expect(message).toContain('markdown (.md) sources only');
      expect(message).toContain('application/pdf');
      expect(message).toContain('roadmap');
      expect(message).toContain('html lands in M9');
    });

  it('errors on an unknown artefact id', async () => {
    const out = await handleReadDocument(
      { resource: 'AAAAAAAAAAAAAAAAAAAAAA' }, deps(),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('unknown artefact id');
  });

  it('reports cross-host redirects from the internal fetch', async () => {
    const redirecting: typeof fetch = async () => new Response(null, {
      status: 302, headers: { location: 'https://other.com/guide.md' },
    });
    const out = await handleReadDocument(
      { resource: MD_URL }, deps(redirecting),
    );
    expect(out.isError).toBeUndefined();
    expect(out.content[0].text).toContain('Redirect detected');
  });

  it('names M9 when custom rules send md to the browser', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      types: {
        ...DEFAULT_SETTINGS.types,
        'text/markdown': {
          retrieval: 'browser', parser: 'raw',
          runtime: 'container', escalate: 'browser',
        } as const,
      },
    };
    const out = await handleReadDocument({ resource: MD_URL }, {
      store: createArtefactStore(root), settings,
      fetchImpl: async () => { throw new Error('no network'); },
    });
    expect(out.isError).toBe(true);
    expect(out.content[0].text)
      .toContain('html/container support lands in M9');
  });

  it('maps pipeline errors to isError results', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const out = await handleReadDocument(
      { resource: MD_URL }, deps(failing),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('fetch failed');
  });
});
