import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtefactStore, type ArtefactStore } from '../store/store.js';
import { artefactId } from '../store/ids.js';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import type { PipelineDeps } from '../fetch/fetch-file.js';
import {
  defuddleHtml, convertHtmlFile, isHtmlSource, isHtmlUri,
} from './convert-html.js';

let root: string;
let store: ArtefactStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-html-'));
  store = createArtefactStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const SIMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Page</title></head>
<body>
<main>
<h1>Test Page</h1>
<p>This is a paragraph with enough content for extraction.</p>
<h2>Section Two</h2>
<p>More content in the second section of the page.</p>
</main>
</body>
</html>`;

const URI = 'https://example.com/page.html';

function deps(): PipelineDeps {
  return {
    store,
    settings: DEFAULT_SETTINGS,
  };
}

describe('isHtmlSource', () => {
  it('recognises text/html', () => {
    expect(isHtmlSource({ mime_type: 'text/html', name: 'p.html' }))
      .toBe(true);
  });
  it('recognises application/xhtml+xml', () => {
    expect(isHtmlSource({
      mime_type: 'application/xhtml+xml', name: 'p.xhtml',
    })).toBe(true);
  });
  it('recognises .html extension even when mime is wrong', () => {
    expect(isHtmlSource({ mime_type: 'text/plain', name: 'p.html' }))
      .toBe(true);
  });
  it('recognises .htm extension', () => {
    expect(isHtmlSource({ mime_type: 'text/plain', name: 'p.htm' }))
      .toBe(true);
  });
  it('rejects non-html', () => {
    expect(isHtmlSource({ mime_type: 'application/pdf', name: 'r.pdf' }))
      .toBe(false);
  });
});

describe('isHtmlUri', () => {
  it('accepts .html', () => {
    expect(isHtmlUri('https://ex.com/page.html')).toBe(true);
  });
  it('accepts .htm', () => {
    expect(isHtmlUri('https://ex.com/page.htm')).toBe(true);
  });
  it('rejects extensionless', () => {
    expect(isHtmlUri('https://ex.com/page')).toBe(false);
  });
  it('rejects non-html extensions', () => {
    expect(isHtmlUri('https://ex.com/data.json')).toBe(false);
  });
});

describe('defuddleHtml', () => {
  it('converts HTML to markdown with metadata', async () => {
    const result = await defuddleHtml(SIMPLE_HTML, URI);
    // Defuddle strips the h1 when it duplicates the title; the body and
    // subheading must survive conversion.
    expect(result.markdown).toContain('Section Two');
    expect(result.markdown).toContain('paragraph');
    expect(result.meta.title).toBe('Test Page');
  });

  it('produces parseable markdown', async () => {
    const result = await defuddleHtml(SIMPLE_HTML, URI);
    // The output should contain markdown heading syntax (section two).
    expect(result.markdown).toMatch(/#{1,6}\s/);
  });

  it('handles minimal HTML', async () => {
    const minimal = '<html><body><p>Hello world</p></body></html>';
    const result = await defuddleHtml(minimal, 'https://ex.com/');
    expect(result.markdown).toBeTruthy();
  });
});

describe('convertHtmlFile', () => {
  it('creates a document Digest from an HTML file Digest', async () => {
    const fileDigest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML },
    });

    const document = await convertHtmlFile(deps(), fileDigest);

    expect(document.type).toBe('document');
    expect(document.document).toBeDefined();
    expect(document.document!.sections.type).toBe('root');
    // The converted document's file is markdown.
    expect(document.file.mime_type).toBe('text/markdown');
    expect(document.file.name).toBe('page.md');
    // HTML documents are read-only (no write adapter in v1).
    expect(document.document!.writable).toBe('none');
    // Related pair: converted_from points back to the file.
    expect(document.related).toEqual([
      { id: fileDigest.id, type: 'converted_from' },
    ]);
  });

  it('records source_file_hash for divergence detection', async () => {
    const fileDigest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML },
    });
    const document = await convertHtmlFile(deps(), fileDigest);
    expect(document.document!.source_file_hash).toBe(fileDigest.file.hash);
  });

  it('links converted_to on the source file Digest', async () => {
    const fileDigest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML },
    });
    const document = await convertHtmlFile(deps(), fileDigest);
    const updated = await store.readDigest(fileDigest.id);
    expect(updated?.related).toEqual([
      { id: document.id, type: 'converted_to' },
    ]);
  });

  it('uses defuddle title as the document name', async () => {
    const fileDigest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'page.html', mimeType: 'text/html', bytes: SIMPLE_HTML },
    });
    const document = await convertHtmlFile(deps(), fileDigest);
    // defuddle extracts the <title> which is "Test Page".
    expect(document.document!.name).toBe('Test Page');
  });

  it('derives the .md master filename from the .html source', async () => {
    const file = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'guide.html', mimeType: 'text/html', bytes: SIMPLE_HTML },
    });
    const doc = await convertHtmlFile(deps(), file);
    expect(doc.file.name).toBe('guide.md');
  });
});
