import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import { DigestSchema, type Digest } from '../store/record.js';
import { createArtefactStore, type ArtefactStore } from '../store/store.js';
import type { PipelineDeps } from '../fetch/fetch-file.js';
import {
  convertMarkdownFile, isMarkdownSource, isMarkdownUri, toStoredSection,
} from './convert-md.js';
import { parseMarkdown } from '../md-engine/index.js';

let root: string;
let store: ArtefactStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-conv-'));
  store = createArtefactStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MD = [
  '---',
  'title: Guide',
  '---',
  '',
  'Intro paragraph before any heading.',
  '',
  '# The Guide',
  '',
  'Getting started is easy. Install the tool. Run the tool.',
  '',
  '## Install',
  '',
  '```sh',
  'npm i guide',
  '```',
  '',
].join('\n');

function deps(): PipelineDeps {
  return { store, settings: DEFAULT_SETTINGS };
}

async function seedFile(
  uri = 'https://ex.com/guide.md', name = 'guide.md', body = MD,
  mime = 'text/markdown',
): Promise<Digest> {
  return store.createDigest({
    originUri: uri, type: 'file',
    file: { name, mimeType: mime, bytes: body },
  });
}

describe('isMarkdownSource / isMarkdownUri', () => {
  it('accepts markdown mimes and .md/.markdown names', () => {
    expect(isMarkdownSource({ mime_type: 'text/markdown', name: 'x' }))
      .toBe(true);
    expect(isMarkdownSource({ mime_type: 'text/plain', name: 'a.md' }))
      .toBe(true);
    expect(isMarkdownSource({
      mime_type: 'application/octet-stream', name: 'a.markdown',
    })).toBe(true);
  });

  it('refuses txt, html and binaries', () => {
    expect(isMarkdownSource({ mime_type: 'text/plain', name: 'a.txt' }))
      .toBe(false);
    expect(isMarkdownSource({ mime_type: 'text/html', name: 'a.html' }))
      .toBe(false);
    expect(isMarkdownSource({ mime_type: 'application/pdf', name: 'a.pdf' }))
      .toBe(false);
  });

  it('checks uris by extension', () => {
    expect(isMarkdownUri('https://ex.com/a.md')).toBe(true);
    expect(isMarkdownUri('https://ex.com/a')).toBe(false);
    expect(isMarkdownUri('https://ex.com/a.pdf')).toBe(false);
  });
});

describe('toStoredSection', () => {
  it('strips byte positions everywhere and keeps the rest', () => {
    const stored = toStoredSection(
      parseMarkdown(MD, { now: '2026-06-13T10:00:00.000Z' }),
    );
    const json = JSON.stringify(stored);
    expect(json).not.toContain('"position"');
    expect(json).toContain('"front-matter"');
    expect(stored.created_at).toBe('2026-06-13T10:00:00.000Z');
  });
});

describe('convertMarkdownFile', () => {
  it('creates the document Digest as a straight copy with tree and extracts',
    async () => {
      const file = await seedFile();
      const doc = await convertMarkdownFile(deps(), file);
      expect(DigestSchema.parse(doc)).toBeTruthy();
      expect(doc.type).toBe('document');
      expect(doc.id).toBe(artefactId(file.origin_uri, 'document'));
      expect(doc.id).not.toBe(file.id);
      // Master md is byte-identical to the source (straight copy).
      const master = await readFile(
        join(store.paths.artefactDir(doc.id), doc.file.name), 'utf8',
      );
      expect(master).toBe(MD);
      expect(doc.file.hash).toBe(file.file.hash);
      // Document branch per design §2.2.
      expect(doc.document?.name).toBe('The Guide');
      expect(doc.document?.writable).toBe('full');
      expect(doc.document?.source_file_hash).toBe(file.file.hash);
      expect(doc.document?.summary).toBeTruthy();
      expect(doc.document?.keywords).toContain('tool');
      const rootSection = doc.document!.sections;
      expect(rootSection.type).toBe('root');
      expect(rootSection.children?.map((s) => s.type))
        .toEqual(['front-matter', 'section']);
      const guide = rootSection.children![1];
      expect(guide.title).toBe('The Guide');
      expect(guide.children?.[0].title).toBe('Install');
      // Relations both ways (§2.3).
      expect(doc.related).toEqual([
        { id: file.id, type: 'converted_from' },
      ]);
      const updatedFile = await store.readDigest(file.id);
      expect(updatedFile?.related).toEqual([
        { id: doc.id, type: 'converted_to' },
      ]);
    });

  it('appends .md to a master name lacking the extension', async () => {
    const file = await seedFile('https://ex.com/readme', 'readme');
    const doc = await convertMarkdownFile(deps(), file);
    expect(doc.file.name).toBe('readme.md');
  });

  it('falls back to the file name when no heading carries a title',
    async () => {
      const file = await seedFile(
        'https://ex.com/plain.md', 'plain.md', 'Just a paragraph.\n',
      );
      const doc = await convertMarkdownFile(deps(), file);
      expect(doc.document?.name).toBe('plain.md');
    });

  it('does not duplicate the converted_to relation on re-conversion',
    async () => {
      const file = await seedFile();
      await convertMarkdownFile(deps(), file);
      const again = await store.readDigest(file.id);
      await convertMarkdownFile(deps(), again!);
      const final = await store.readDigest(file.id);
      expect(final?.related).toHaveLength(1);
    });

  it('handles an empty markdown file', async () => {
    const file = await seedFile('https://ex.com/empty.md', 'empty.md', '');
    const doc = await convertMarkdownFile(deps(), file);
    expect(doc.document?.sections.type).toBe('root');
    expect(doc.document?.summary).toBeUndefined();
    expect(doc.document?.keywords).toBeUndefined();
  });
});
