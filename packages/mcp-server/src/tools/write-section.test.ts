import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtefactStore, artefactId } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';
import type { ServerDeps } from '../deps.js';
import { handleFetchFile } from './fetch-file.js';
import { handleReadDocument } from './read-document.js';
import { handleReadSection } from './read-section.js';
import { handleWriteSection } from './write-section.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'digest-tws-'));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';
const MD = [
  '---', 'title: Guide', '---', '',
  '# Guide', '', 'Intro paragraph.', '',
  '## Install', '', 'Run the installer.', '',
  '## Usage', '', 'Use it like this.', '',
  '### Advanced', '', 'Advanced usage notes.', '',
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

interface TocSection {
  id: string;
  type: string;
  hash: string;
  title?: string;
  children?: TocSection[];
}

interface FullSection {
  id: string;
  type: string;
  hash: string;
  title?: string;
  content?: { type: string; value: string; hash: string }[];
  children?: FullSection[];
}

async function setupDocument(d: ServerDeps) {
  await handleFetchFile({ uri: MD_URL }, d);
  const readResult = await handleReadDocument({ resource: MD_URL }, d);
  const body = JSON.parse(readResult.content[0].text) as {
    id: string;
    document: { sections: TocSection };
  };
  return body;
}

function findByTitle(
  section: TocSection, title: string,
): TocSection | undefined {
  if (section.title === title) return section;
  for (const child of section.children ?? []) {
    const found = findByTitle(child, title);
    if (found) return found;
  }
  return undefined;
}

function findByType(
  section: TocSection, type: string,
): TocSection | undefined {
  if (section.type === type) return section;
  for (const child of section.children ?? []) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('handleWriteSection', () => {
  // --- Replace semantics ---

  it('replaces a section content via splice and re-parse', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const install = findByTitle(doc.document.sections, 'Install')!;
    expect(install).toBeDefined();

    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'Updated installer docs.' }],
      },
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      artefact_id: string;
      sections: TocSection;
    };
    expect(body.artefact_id).toBe(doc.id);

    // Verify the write persisted: read_section returns the updated content.
    const read = await handleReadSection({
      artefact_id: doc.id, section_id: install.id,
    }, d);
    const readBody = JSON.parse(read.content[0].text) as {
      sections: FullSection[];
    };
    const content = readBody.sections[0].content!;
    expect(content.some(
      (b) => b.value.includes('Updated installer docs.'),
    )).toBe(true);
  });

  // --- Deletion of absent children ---

  it('deletes children absent from the input subtree', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    // Usage has an Advanced child. Write Usage without children to delete
    // Advanced.
    const usage = findByTitle(doc.document.sections, 'Usage')!;
    expect(usage.children).toBeDefined();
    expect(usage.children!.length).toBeGreaterThan(0);
    const advancedId = usage.children![0].id;

    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: usage.id,
        hash: usage.hash,
        content: [{ type: 'paragraph', value: 'Just use it.' }],
        children: [], // no children = delete all
      },
    }, d);
    expect(out.isError).toBeUndefined();

    // Verify Advanced is gone.
    const read = await handleReadSection({
      artefact_id: doc.id, section_id: advancedId,
    }, d);
    expect(read.isError).toBe(true);
    expect(read.content[0].text).toContain('unknown section id');
  });

  // --- New node minting ---

  it('mints new section ids for unknown children', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const install = findByTitle(doc.document.sections, 'Install')!;

    // Add a new child section under Install.
    const newId = 'AAAAAAAAAAAAAAAAAAAAAA'; // valid 22-char id
    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'Install guide.' }],
        children: [{
          id: newId,
          type: 'section',
          title: 'Prerequisites',
          content: [{ type: 'paragraph', value: 'Need Node 22.' }],
        }],
      },
    }, d);
    expect(out.isError).toBeUndefined();

    // The new section should be readable.
    const readDoc = await handleReadDocument({ resource: MD_URL }, d);
    const docBody = JSON.parse(readDoc.content[0].text) as {
      document: { sections: TocSection };
    };
    const prereqs = findByTitle(docBody.document.sections, 'Prerequisites');
    expect(prereqs).toBeDefined();
  });

  // --- Hash lock: stale hash rejected ---

  it('rejects the entire write on hash mismatch', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const install = findByTitle(doc.document.sections, 'Install')!;

    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: install.id,
        hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        content: [{ type: 'paragraph', value: 'Should not write.' }],
      },
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('hash mismatch');
    expect(out.content[0].text).toContain(install.id);
  });

  // --- Content-only hash composition: sibling insert does NOT invalidate ---

  it('sibling insert does not invalidate later siblings hashes', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const root = doc.document.sections;
    const install = findByTitle(root, 'Install')!;
    const usage = findByTitle(root, 'Usage')!;

    // First: record the Usage hash BEFORE any write.
    const usageHashBefore = usage.hash;

    // Write to Install (a sibling of Usage), adding a new child.
    const writeInstall = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'New install content.' }],
        children: [{
          id: 'BBBBBBBBBBBBBBBBBBBBBB',
          type: 'section',
          title: 'From Source',
          content: [{ type: 'paragraph', value: 'Build from source.' }],
        }],
      },
    }, d);
    expect(writeInstall.isError).toBeUndefined();

    // Now read the document again and check Usage hash.
    const readDoc = await handleReadDocument({ resource: MD_URL }, d);
    const docBody = JSON.parse(readDoc.content[0].text) as {
      document: { sections: TocSection };
    };
    const usageAfter = findByTitle(docBody.document.sections, 'Usage')!;

    // Usage hash should NOT have changed (content-only composition,
    // positions are outside the hash).
    expect(usageAfter.hash).toBe(usageHashBefore);

    // And a write to Usage with the original hash should succeed.
    const writeUsage = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: usage.id,
        hash: usageHashBefore,
        content: [{ type: 'paragraph', value: 'Updated usage.' }],
        children: usage.children?.map((c) => ({
          id: c.id,
          hash: c.hash,
          content: [{ type: 'paragraph', value: 'Still advanced.' }],
        })) ?? [],
      },
    }, d);
    expect(writeUsage.isError).toBeUndefined();
  });

  // --- Front-matter YAML validation ---

  it('validates front-matter YAML before splice', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const fm = findByType(doc.document.sections, 'front-matter')!;
    expect(fm).toBeDefined();

    // Read the front-matter section to get its hash.
    const readFm = await handleReadSection({
      artefact_id: doc.id, section_id: fm.id,
    }, d);
    const fmBody = JSON.parse(readFm.content[0].text) as {
      sections: FullSection[];
    };
    const fmHash = fmBody.sections[0].hash;

    // Valid YAML write should succeed.
    const validOut = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: fm.id,
        hash: fmHash,
        type: 'front-matter',
        content: [{
          type: 'code',
          value: 'title: Updated Guide\nauthor: Test',
          meta: { lang: 'yaml' },
        }],
      },
    }, d);
    expect(validOut.isError).toBeUndefined();

    // Invalid YAML write should be rejected.
    // Re-read to get the new hash after the valid write.
    const readFm2 = await handleReadSection({
      artefact_id: doc.id, section_id: fm.id,
    }, d);
    const fmBody2 = JSON.parse(readFm2.content[0].text) as {
      sections: FullSection[];
    };
    const fmHash2 = fmBody2.sections[0].hash;

    const invalidOut = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: fm.id,
        hash: fmHash2,
        type: 'front-matter',
        content: [{
          type: 'code',
          value: ': [unclosed',
          meta: { lang: 'yaml' },
        }],
      },
    }, d);
    expect(invalidOut.isError).toBe(true);
    expect(invalidOut.content[0].text).toContain('invalid YAML');
  });

  // --- Raw file untouched ---

  it('leaves the file Digest (raw file) byte-identical after write',
    async () => {
      const d = deps();
      const doc = await setupDocument(d);
      const fileId = artefactId(MD_URL, 'file');
      const store = d.store;

      // Read the raw file bytes before write.
      const fileDigestBefore = await store.readDigest(fileId);
      expect(fileDigestBefore).not.toBeNull();
      const rawPathBefore = join(
        store.paths.artefactDir(fileId),
        fileDigestBefore!.file.name,
      );
      const rawBytesBefore = readFileSync(rawPathBefore);

      // Write a section.
      const install = findByTitle(doc.document.sections, 'Install')!;
      const out = await handleWriteSection({
        artefact_id: doc.id,
        section: {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Changed.' }],
        },
      }, d);
      expect(out.isError).toBeUndefined();

      // The raw file should be unchanged.
      const fileDigestAfter = await store.readDigest(fileId);
      const rawBytesAfter = readFileSync(rawPathBefore);
      expect(rawBytesAfter).toEqual(rawBytesBefore);
      expect(fileDigestAfter!.file.hash).toBe(fileDigestBefore!.file.hash);
    });

  // --- Round-trip: write then read returns written content ---

  it('round-trips: write then read_section returns the written content',
    async () => {
      const d = deps();
      const doc = await setupDocument(d);
      const install = findByTitle(doc.document.sections, 'Install')!;

      const newContent = 'This is the brand new install guide.';
      await handleWriteSection({
        artefact_id: doc.id,
        section: {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: newContent }],
        },
      }, d);

      const read = await handleReadSection({
        artefact_id: doc.id, section_id: install.id,
      }, d);
      expect(read.isError).toBeUndefined();
      const body = JSON.parse(read.content[0].text) as {
        sections: FullSection[];
      };
      expect(body.sections[0].content!.some(
        (b) => b.value.includes(newContent),
      )).toBe(true);
    });

  // --- Writable capability ---

  it('rejects writes on non-writable artefacts', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const install = findByTitle(doc.document.sections, 'Install')!;

    // Patch the document to be non-writable.
    await d.store.updateDigest(doc.id, {
      mutate: (digest) => {
        digest.document!.writable = 'none';
      },
    });

    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'Should fail.' }],
      },
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('not writable');
  });

  // --- Error cases ---

  it('errors on unknown artefact id', async () => {
    const d = deps();
    const out = await handleWriteSection({
      artefact_id: 'AAAAAAAAAAAAAAAAAAAAAA',
      section: {
        id: 'BBBBBBBBBBBBBBBBBBBBBB',
        content: [{ type: 'paragraph', value: 'Hi.' }],
      },
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('unknown artefact');
  });

  it('errors on a file-type artefact', async () => {
    const d = deps();
    await handleFetchFile({ uri: MD_URL }, d);
    const fileId = artefactId(MD_URL, 'file');
    const out = await handleWriteSection({
      artefact_id: fileId,
      section: {
        id: 'BBBBBBBBBBBBBBBBBBBBBB',
        content: [{ type: 'paragraph', value: 'Hi.' }],
      },
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('not a document artefact');
  });

  it('errors when root section id does not exist', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const out = await handleWriteSection({
      artefact_id: doc.id,
      section: {
        id: 'ZZZZZZZZZZZZZZZZZZZZZZ',
        content: [{ type: 'paragraph', value: 'Hi.' }],
      },
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('not found');
  });
});
