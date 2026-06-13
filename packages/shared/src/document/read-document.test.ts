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

  it('passes browser-needed through for md uris under custom rules',
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
      expect(out).toEqual({ kind: 'browser-needed', mime: 'text/markdown' });
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

describe('source-change divergence detection (M7)', () => {
  it('reports sourceChanged false when source file hash matches',
    async () => {
      // Initial fetch and convert: hashes match by construction.
      const out = await readDocumentArtefact(deps(mdServer()), MD_URL);
      expect(out.kind).toBe('document');
      if (out.kind !== 'document') return;
      expect(out.sourceChanged).toBe(false);
      // Second read should still report no change.
      const second = await readDocumentArtefact(deps(), MD_URL);
      expect(second.kind).toBe('document');
      if (second.kind !== 'document') return;
      expect(second.sourceChanged).toBe(false);
    });

  it('reports sourceChanged true when the source file has been re-fetched ' +
    'with new content and the document was edited', async () => {
    // Step 1: initial fetch and conversion.
    const first = await readDocumentArtefact(deps(mdServer()), MD_URL);
    if (first.kind !== 'document') throw new Error('expected document');
    const docId = first.digest.id;

    // Step 2: simulate the source file being re-fetched with new bytes.
    const fileId = artefactId(MD_URL, 'file');
    await store.updateDigest(fileId, {
      bytes: '# Updated title\n\nNew content.\n',
    });

    // Step 3: simulate the document being locally edited (file.hash
    // diverges from source_file_hash because the master md was changed).
    const updatedMd = '# Edited by user\n\nCustom content.\n';
    await store.updateDigest(docId, { bytes: updatedMd });

    // Step 4: reading the document should detect the divergence.
    const out = await readDocumentArtefact(deps(), MD_URL);
    expect(out.kind).toBe('document');
    if (out.kind !== 'document') return;
    expect(out.sourceChanged).toBe(true);
    // The original document should NOT be overwritten.
    expect(out.digest.id).toBe(docId);
  });

  it('auto-regenerates document when source changed but doc is untouched',
    async () => {
      // Step 1: initial fetch and conversion.
      const first = await readDocumentArtefact(deps(mdServer()), MD_URL);
      if (first.kind !== 'document') throw new Error('expected document');
      const originalSections = first.digest.document?.sections;

      // Step 2: simulate the source file being re-fetched with new bytes.
      // The document was NOT locally edited, so its file.hash still
      // equals source_file_hash (the master md is a verbatim copy of the
      // old source file).
      const fileId = artefactId(MD_URL, 'file');
      const newMd = '# New title\n\nDifferent content.\n\n## Setup\n\nDo it.\n';
      await store.updateDigest(fileId, { bytes: newMd });

      // Step 3: reading the document should auto-regenerate.
      const out = await readDocumentArtefact(deps(), MD_URL);
      expect(out.kind).toBe('document');
      if (out.kind !== 'document') return;
      expect(out.sourceChanged).toBe(false);
      // The regenerated document should have the new title.
      expect(out.digest.document?.name).toBe('New title');
      // Section ids are re-minted on regeneration.
      expect(out.digest.document?.sections.id).not.toBe(
        originalSections?.id,
      );
    });

  it('preserves edited document even after source file re-fetch',
    async () => {
      // This is the key safety property: a locally edited document is
      // NEVER auto-overwritten by source changes.
      const first = await readDocumentArtefact(deps(mdServer()), MD_URL);
      if (first.kind !== 'document') throw new Error('expected document');
      const docId = first.digest.id;

      // Edit the document locally.
      const edited = '# Edited\n\nUser content.\n';
      await store.updateDigest(docId, { bytes: edited });

      // Re-fetch source with different content.
      const fileId = artefactId(MD_URL, 'file');
      await store.updateDigest(fileId, { bytes: '# V2\n' });

      // Document should not be overwritten.
      const out = await readDocumentArtefact(deps(), MD_URL);
      if (out.kind !== 'document') throw new Error('expected document');
      expect(out.sourceChanged).toBe(true);
      // The document's file hash is the edited content, not the new source.
      const doc = await store.readDigest(docId);
      expect(doc?.file.hash).not.toBe(
        (await store.readDigest(fileId))?.file.hash,
      );
    });
});
