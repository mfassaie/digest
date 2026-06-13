import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import { createArtefactStore, type ArtefactStore } from '../store/store.js';
import type { PipelineDeps } from '../fetch/fetch-file.js';
import { readDocumentArtefact } from './read-document.js';

let root: string;
let store: ArtefactStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-read-'));
  store = createArtefactStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MD_URL = 'https://ex.com/guide.md';
const MD = '# Title\n\nIntro paragraph.\n\n## Install\n\nRun it.\n';

function mdServer(): typeof fetch {
  return async () => new Response(MD, {
    status: 200, headers: { 'content-type': 'text/markdown' },
  });
}

function noNetwork(): typeof fetch {
  return async () => { throw new Error('network must not be touched'); };
}

function deps(fetchImpl: typeof fetch = noNetwork()): PipelineDeps {
  return { store, settings: DEFAULT_SETTINGS, fetchImpl };
}

describe('readDocumentArtefact by uri', () => {
  it('fetches internally and converts when nothing is stored', async () => {
    const out = await readDocumentArtefact(deps(mdServer()), MD_URL);
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.sourceChanged).toBe(false);
    expect(out.digest.type).toBe('document');
    expect(out.digest.document?.sections.children?.[0].title).toBe('Title');
    // Both artefacts now exist, related both ways (§2.3).
    const file = await store.readDigest(artefactId(MD_URL, 'file'));
    expect(file?.related).toEqual([
      { id: out.digest.id, type: 'converted_to' },
    ]);
  });

  it('converts a stored file Digest without touching the network',
    async () => {
      await store.createDigest({
        originUri: MD_URL, type: 'file',
        file: { name: 'guide.md', mimeType: 'text/markdown', bytes: MD },
      });
      const out = await readDocumentArtefact(deps(), MD_URL);
      expect(out.kind).toBe('document');
    });

  it('serves an existing document Digest as-is', async () => {
    const first = await readDocumentArtefact(deps(mdServer()), MD_URL);
    if (first.kind !== 'document') throw new Error('expected document');
    const second = await readDocumentArtefact(deps(), MD_URL);
    if (second.kind !== 'document') throw new Error('expected document');
    // Same record, same sticky section ids — no regeneration on read.
    expect(second.digest.document?.sections.id)
      .toBe(first.digest.document?.sections.id);
  });

  it('refuses a non-md uri before any network call', async () => {
    const out = await readDocumentArtefact(
      deps(), 'https://ex.com/report.pdf',
    );
    expect(out).toEqual({
      kind: 'unsupported',
      name: 'https://ex.com/report.pdf',
      mime: 'application/pdf',
    });
  });

  it('passes fetch errors through', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const out = await readDocumentArtefact(deps(failing), MD_URL);
    expect(out).toEqual({ kind: 'error', reason: 'fetch failed' });
  });

  it('soft-errors when custom rules need the browser but no transport',
    async () => {
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
      const out = await readDocumentArtefact(
        { store, settings, fetchImpl: noNetwork() }, MD_URL,
      );
      expect(out.kind).toBe('error');
      expect((out as { reason: string }).reason)
        .toContain('stealth browser');
    });

  it('reads local markdown paths end to end', async () => {
    const path = join(root, 'notes.md');
    await writeFile(path, '# Local notes\n', 'utf8');
    const out = await readDocumentArtefact(deps(), path);
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.digest.document?.name).toBe('Local notes');
  });

  it('rejects an invalid resource', async () => {
    const out = await readDocumentArtefact(deps(), 'mailto:a@b.c');
    expect(out.kind).toBe('error');
  });
});

const SIMPLE_HTML = '<!DOCTYPE html><html><head><title>Page</title></head>' +
  '<body><main><h1>Page Title</h1>' +
  '<p>Content paragraph here.</p></main></body></html>';

describe('readDocumentArtefact with HTML (M9)', () => {
  it('converts a stored HTML file Digest into a document', async () => {
    await store.createDigest({
      originUri: 'https://ex.com/page.html',
      type: 'file',
      file: {
        name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML,
      },
    });
    const out = await readDocumentArtefact(
      deps(), 'https://ex.com/page.html',
    );
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.digest.type).toBe('document');
    expect(out.digest.file.mime_type).toBe('text/markdown');
    expect(out.digest.document?.writable).toBe('none');
  });

  it('fetches and converts an html URI end to end', async () => {
    const htmlServer: typeof fetch = async () => new Response(SIMPLE_HTML, {
      status: 200, headers: { 'content-type': 'text/html' },
    });
    // Override html rule to allow local retrieval for testing.
    const settings = {
      ...DEFAULT_SETTINGS,
      types: {
        ...DEFAULT_SETTINGS.types,
        'text/html': {
          retrieval: 'http' as const, parser: 'raw' as const,
          runtime: 'local' as const, escalate: 'none' as const,
        },
      },
    };
    const out = await readDocumentArtefact(
      { store, settings, fetchImpl: htmlServer },
      'https://ex.com/page.html',
    );
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.digest.document?.name).toBe('Page');
  });

  it('does not re-convert an existing document for an html source',
    async () => {
      await store.createDigest({
        originUri: 'https://ex.com/page.html',
        type: 'file',
        file: {
          name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML,
        },
      });
      const first = await readDocumentArtefact(
        deps(), 'https://ex.com/page.html',
      );
      if (first.kind !== 'document') throw new Error('expected document');
      const second = await readDocumentArtefact(
        deps(), 'https://ex.com/page.html',
      );
      if (second.kind !== 'document') throw new Error('expected document');
      expect(second.digest.document?.sections.id)
        .toBe(first.digest.document?.sections.id);
    });
});

describe('readDocumentArtefact by artefact id', () => {
  it('serves a document id directly', async () => {
    const seeded = await readDocumentArtefact(deps(mdServer()), MD_URL);
    if (seeded.kind !== 'document') throw new Error('expected document');
    const out = await readDocumentArtefact(deps(), seeded.digest.id);
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.digest.id).toBe(seeded.digest.id);
  });

  it('hops converted_to from a file id', async () => {
    const seeded = await readDocumentArtefact(deps(mdServer()), MD_URL);
    if (seeded.kind !== 'document') throw new Error('expected document');
    const fileId = artefactId(MD_URL, 'file');
    const out = await readDocumentArtefact(deps(), fileId);
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.digest.id).toBe(seeded.digest.id);
    expect(out.digest.type).toBe('document');
  });

  it('converts on demand for a md file id without a relation', async () => {
    const file = await store.createDigest({
      originUri: MD_URL, type: 'file',
      file: { name: 'guide.md', mimeType: 'text/markdown', bytes: MD },
    });
    const out = await readDocumentArtefact(deps(), file.id);
    expect(out.kind).toBe('document');
  });

  it('reports a non-md file id as unsupported, naming the type',
    async () => {
      const file = await store.createDigest({
        originUri: 'https://ex.com/r.pdf', type: 'file',
        file: { name: 'r.pdf', mimeType: 'application/pdf', bytes: '%PDF' },
      });
      const out = await readDocumentArtefact(deps(), file.id);
      expect(out).toEqual({
        kind: 'unsupported', name: 'r.pdf', mime: 'application/pdf',
      });
    });

  it('errors on an unknown artefact id', async () => {
    const out = await readDocumentArtefact(
      deps(), 'AAAAAAAAAAAAAAAAAAAAAA',
    );
    expect(out).toEqual({
      kind: 'error', reason: 'unknown artefact id: AAAAAAAAAAAAAAAAAAAAAA',
    });
  });
});
