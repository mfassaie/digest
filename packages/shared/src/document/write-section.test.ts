import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtefactStore, type ArtefactStore } from '../store/store.js';
import { artefactId, mintGuid } from '../store/ids.js';
import { hashBytes } from '../store/hash.js';
import { parseMarkdown } from '../md-engine/fold.js';
import { toStoredSection } from './convert-md.js';
import {
  writeSection,
  WriteSectionError,
  type WriteSectionDeps,
  type WriteSectionInput,
} from './write-section.js';
import type { Digest, DigestDocument, DocumentSection } from '../store/record.js';

// -- Markdown fixtures -----------------------------------------------

const SIMPLE_MD = [
  '# Guide',
  '',
  'Intro paragraph.',
  '',
  '## Install',
  '',
  'Run `npm i`.',
  '',
  '## Usage',
  '',
  'Call the CLI.',
  '',
].join('\n');

const FM_MD = [
  '---',
  'title: Guide',
  'version: 1',
  '---',
  '',
  '# Guide',
  '',
  'Body text.',
  '',
].join('\n');

const NESTED_MD = [
  '# Top',
  '',
  'Top content.',
  '',
  '## Child A',
  '',
  'Child A content.',
  '',
  '### Grandchild',
  '',
  'Grandchild content.',
  '',
  '## Child B',
  '',
  'Child B content.',
  '',
].join('\n');

const CODE_MD = [
  '# Code example',
  '',
  '```js',
  'console.log("hello");',
  '```',
  '',
].join('\n');

// -- Helpers ----------------------------------------------------------

const T0 = '2025-01-01T00:00:00.000Z';

let root: string;
let store: ArtefactStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-ws-'));
  store = createArtefactStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeDeps(overrides?: Partial<WriteSectionDeps>): WriteSectionDeps {
  return { store, now: () => new Date(T0), ...overrides };
}

// Seed a document artefact from markdown: file -> parse -> create as
// document type with sections tree, writable capability, and file bytes.
async function seedDocument(
  md: string,
  opts: {
    uri?: string;
    writable?: DigestDocument['writable'];
  } = {},
): Promise<Digest> {
  const uri = opts.uri ?? 'https://ex.com/guide.md';
  const stamp = T0;
  const parsed = parseMarkdown(md, { now: stamp });
  const stored = toStoredSection(parsed);
  const fileDigest = await store.createDigest({
    originUri: uri,
    type: 'file',
    file: { name: 'guide.md', mimeType: 'text/markdown', bytes: md },
  });
  return store.createDigest({
    originUri: uri,
    type: 'document',
    file: { name: 'guide.md', mimeType: 'text/markdown', bytes: md },
    document: {
      name: 'Guide',
      writable: opts.writable ?? 'full',
      source_file_hash: fileDigest.file.hash,
      sections: stored,
    },
    related: [{ id: fileDigest.id, type: 'converted_from' }],
  });
}

// Walk the stored section tree to find a section by predicate.
function findStored(
  section: DocumentSection,
  pred: (s: DocumentSection) => boolean,
): DocumentSection | undefined {
  if (pred(section)) return section;
  for (const c of section.children ?? []) {
    const found = findStored(c, pred);
    if (found) return found;
  }
  return undefined;
}

// =====================================================================
// Tests
// =====================================================================

describe('writeSection: happy path', () => {
  it('1. writes content to an existing section', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    // Find the "Install" section.
    const install = findStored(sections, (s) => s.title === 'Install')!;
    expect(install).toBeDefined();

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{ type: 'paragraph', value: 'Run `pnpm add guide`.' }],
    };

    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest.id).toBe(doc.id);
    // The updated section tree should contain the new content.
    const updated = findStored(
      result.sections, (s) => s.title === 'Install',
    )!;
    expect(updated).toBeDefined();
    expect(updated.content?.[0].value).toBe('Run `pnpm add guide`.');

    // Verify the markdown file on disk was updated.
    const masterPath = join(store.paths.artefactDir(doc.id), 'guide.md');
    const onDisk = await readFile(masterPath, 'utf8');
    expect(onDisk).toContain('Run `pnpm add guide`.');
    expect(onDisk).not.toContain('Run `npm i`.');
  });

  it('2. replaces a section with children (full subtree)', async () => {
    const doc = await seedDocument(NESTED_MD);
    const sections = doc.document!.sections;
    // Find "Top" section (depth 1, has children).
    const top = findStored(sections, (s) => s.title === 'Top')!;
    expect(top).toBeDefined();
    expect(top.children).toBeDefined();

    const childA = top.children![0]!;
    const input: WriteSectionInput = {
      id: top.id,
      hash: top.hash,
      content: [{ type: 'paragraph', value: 'Replaced top content.' }],
      children: [{
        id: childA.id,
        hash: childA.hash,
        content: [{ type: 'paragraph', value: 'Replaced child A.' }],
      }],
    };

    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    const updatedTop = findStored(
      result.sections, (s) => s.title === 'Top',
    )!;
    expect(updatedTop.content?.[0].value).toBe('Replaced top content.');
    // Child B should be absent (children_mode = 'replace' drops absent).
    const childNames = (updatedTop.children ?? [])
      .map((c) => c.title);
    expect(childNames).not.toContain('Child B');
  });

  it('3. new child added with a valid 22-char id', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;
    const install = findStored(sections, (s) => s.title === 'Install')!;
    const newId = mintGuid();

    const input: WriteSectionInput = {
      id: guide.id,
      hash: guide.hash,
      content: [{ type: 'paragraph', value: 'Intro paragraph.' }],
      children: [
        {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Run `npm i`.' }],
        },
        {
          id: newId,
          type: 'section',
          title: 'New Section',
          content: [{ type: 'paragraph', value: 'Brand new content.' }],
        },
      ],
    };

    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    const masterPath = join(store.paths.artefactDir(doc.id), 'guide.md');
    const onDisk = await readFile(masterPath, 'utf8');
    expect(onDisk).toContain('## New Section');
    expect(onDisk).toContain('Brand new content.');
  });

  it('4. content block with meta.lang is forwarded through serialisation',
    async () => {
      const doc = await seedDocument(CODE_MD);
      const sections = doc.document!.sections;
      const codeSection = findStored(
        sections, (s) => s.title === 'Code example',
      )!;

      // The serialiser writes block values verbatim, so fenced code must
      // include the fences in the value. meta.lang is forwarded through
      // buildSerialiseTree into the serialise tree.
      const input: WriteSectionInput = {
        id: codeSection.id,
        hash: codeSection.hash,
        content: [{
          type: 'code',
          value: '```python\nprint("hello")\n```',
          meta: { lang: 'python' },
        }],
      };

      const result = await writeSection(
        doc.id, input, 'replace', makeDeps(),
      );
      const masterPath = join(store.paths.artefactDir(doc.id), 'guide.md');
      const onDisk = await readFile(masterPath, 'utf8');
      expect(onDisk).toContain('```python');
      expect(onDisk).toContain('print("hello")');
    });
});

describe('writeSection: error codes', () => {
  it('5. unknown_artefact for non-existent id', async () => {
    const fakeId = mintGuid();
    const input: WriteSectionInput = {
      id: 'whatever',
      content: [{ type: 'paragraph', value: 'x' }],
    };
    await expect(writeSection(fakeId, input, 'replace', makeDeps()))
      .rejects.toThrow(WriteSectionError);
    try {
      await writeSection(fakeId, input, 'replace', makeDeps());
    } catch (e) {
      expect((e as WriteSectionError).code).toBe('unknown_artefact');
    }
  });

  it('6. not_document for file-type artefact', async () => {
    const file = await store.createDigest({
      originUri: 'https://ex.com/data.md',
      type: 'file',
      file: { name: 'data.md', mimeType: 'text/markdown', bytes: '# Data' },
    });
    const input: WriteSectionInput = {
      id: 'whatever',
      content: [{ type: 'paragraph', value: 'x' }],
    };
    try {
      await writeSection(file.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('not_document');
    }
  });

  it('7. not_writable when writable=none', async () => {
    const doc = await seedDocument(SIMPLE_MD, { writable: 'none' });
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{ type: 'paragraph', value: 'Nope.' }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('not_writable');
    }
  });

  it('8. not_writable for disallowed block type (array mode)', async () => {
    const doc = await seedDocument(SIMPLE_MD, {
      writable: ['paragraph'],
    });
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{ type: 'code', value: 'npm i' }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('not_writable');
    }
  });

  it('9. unknown_root for non-existent section id', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const input: WriteSectionInput = {
      id: mintGuid(),
      content: [{ type: 'paragraph', value: 'x' }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('unknown_root');
    }
  });

  it('10. hash_mismatch with stale hash on root section', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: 'sha256:' + '0'.repeat(64), // stale hash
      content: [{ type: 'paragraph', value: 'x' }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      const err = e as WriteSectionError;
      expect(err.code).toBe('hash_mismatch');
      expect(err.details?.mismatched_ids).toContain(install.id);
    }
  });

  it('11. hash_mismatch on nested child', async () => {
    const doc = await seedDocument(NESTED_MD);
    const sections = doc.document!.sections;
    const top = findStored(sections, (s) => s.title === 'Top')!;
    const childA = findStored(sections, (s) => s.title === 'Child A')!;

    const input: WriteSectionInput = {
      id: top.id,
      hash: top.hash,
      children: [{
        id: childA.id,
        hash: 'sha256:' + 'f'.repeat(64), // stale
        content: [{ type: 'paragraph', value: 'x' }],
      }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      const err = e as WriteSectionError;
      expect(err.code).toBe('hash_mismatch');
      expect(err.details?.mismatched_ids).toContain(childA.id);
    }
  });

  it('12. invalid_yaml for bad YAML in front-matter', async () => {
    const doc = await seedDocument(FM_MD);
    const sections = doc.document!.sections;
    const fm = findStored(sections, (s) => s.type === 'front-matter')!;
    expect(fm).toBeDefined();

    const input: WriteSectionInput = {
      id: fm.id,
      hash: fm.hash,
      type: 'front-matter',
      content: [{ type: 'code', value: ': : : bad yaml {{[' }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('invalid_yaml');
    }
  });

  it('13. invalid_id for malformed id on new node', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;
    const install = findStored(sections, (s) => s.title === 'Install')!;
    const usage = findStored(sections, (s) => s.title === 'Usage')!;

    const input: WriteSectionInput = {
      id: guide.id,
      hash: guide.hash,
      content: [{ type: 'paragraph', value: 'Intro paragraph.' }],
      children: [
        {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Run `npm i`.' }],
        },
        {
          id: usage.id,
          hash: usage.hash,
          content: [{ type: 'paragraph', value: 'Call the CLI.' }],
        },
        {
          // Invalid id: too short and contains illegal chars.
          id: 'bad!id',
          type: 'section',
          title: 'Bad',
          content: [{ type: 'paragraph', value: 'x' }],
        },
      ],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('invalid_id');
    }
  });
});

describe('writeSection: writable capability', () => {
  it('14. writable=full allows any block type', async () => {
    const doc = await seedDocument(SIMPLE_MD, { writable: 'full' });
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [
        { type: 'paragraph', value: 'Text.' },
        { type: 'code', value: 'npm i' },
        { type: 'table', value: '| a | b |' },
      ],
    };
    // Should not throw.
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });

  it('15. writable=[paragraph,code] allows listed types, rejects table',
    async () => {
      const doc = await seedDocument(SIMPLE_MD, {
        writable: ['paragraph', 'code'],
      });
      const sections = doc.document!.sections;
      const install = findStored(sections, (s) => s.title === 'Install')!;

      // Allowed types pass.
      const goodInput: WriteSectionInput = {
        id: install.id,
        hash: install.hash,
        content: [
          { type: 'paragraph', value: 'ok' },
          { type: 'code', value: 'ok' },
        ],
      };
      await expect(
        writeSection(doc.id, goodInput, 'replace', makeDeps()),
      ).resolves.toBeDefined();

      // Re-seed because the first write changed hashes.
      const doc2 = await seedDocument(SIMPLE_MD, {
        uri: 'https://ex.com/guide2.md',
        writable: ['paragraph', 'code'],
      });
      const sections2 = doc2.document!.sections;
      const install2 = findStored(sections2, (s) => s.title === 'Install')!;

      const badInput: WriteSectionInput = {
        id: install2.id,
        hash: install2.hash,
        content: [{ type: 'table', value: '| a |' }],
      };
      try {
        await writeSection(doc2.id, badInput, 'replace', makeDeps());
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as WriteSectionError).code).toBe('not_writable');
      }
    });

  it('16. nested child block types checked recursively', async () => {
    const doc = await seedDocument(NESTED_MD, {
      writable: ['paragraph'],
    });
    const sections = doc.document!.sections;
    const top = findStored(sections, (s) => s.title === 'Top')!;
    const childA = findStored(sections, (s) => s.title === 'Child A')!;

    const input: WriteSectionInput = {
      id: top.id,
      hash: top.hash,
      content: [{ type: 'paragraph', value: 'ok' }],
      children: [{
        id: childA.id,
        hash: childA.hash,
        // This child has a disallowed block type.
        content: [{ type: 'code', value: 'rejected' }],
      }],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as WriteSectionError).code).toBe('not_writable');
    }
  });
});

describe('writeSection: hash validation', () => {
  it('17. hash present and matching: no error raised', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash, // correct hash
      content: [{ type: 'paragraph', value: 'Updated.' }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });

  it('18. hash absent on known node: passes (optional per code)', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      // No hash field at all.
      content: [{ type: 'paragraph', value: 'Updated without hash.' }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });

  it('19. hash on unknown node (new section): ignored', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;
    const install = findStored(sections, (s) => s.title === 'Install')!;
    const usage = findStored(sections, (s) => s.title === 'Usage')!;
    const newId = mintGuid();

    const input: WriteSectionInput = {
      id: guide.id,
      hash: guide.hash,
      content: [{ type: 'paragraph', value: 'Intro paragraph.' }],
      children: [
        {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Run `npm i`.' }],
        },
        {
          id: usage.id,
          hash: usage.hash,
          content: [{ type: 'paragraph', value: 'Call the CLI.' }],
        },
        {
          id: newId,
          hash: 'sha256:' + 'a'.repeat(64), // hash on a new node
          type: 'section',
          title: 'Extra',
          content: [{ type: 'paragraph', value: 'New.' }],
        },
      ],
    };
    // Should not throw: hash on unknown nodes is ignored.
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });
});

describe('writeSection: front-matter validation', () => {
  it('20. non-front-matter section bypasses YAML validation', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    // Content with YAML-like but invalid syntax: passes because it is not
    // a front-matter section.
    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{ type: 'paragraph', value: ': : invalid yaml {{[' }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });

  it('21. front-matter with valid YAML passes', async () => {
    const doc = await seedDocument(FM_MD);
    const sections = doc.document!.sections;
    const fm = findStored(sections, (s) => s.type === 'front-matter')!;

    const input: WriteSectionInput = {
      id: fm.id,
      hash: fm.hash,
      type: 'front-matter',
      content: [{
        type: 'code',
        value: 'title: Updated Guide\nversion: 2',
      }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    const masterPath = join(store.paths.artefactDir(doc.id), 'guide.md');
    const onDisk = await readFile(masterPath, 'utf8');
    expect(onDisk).toContain('title: Updated Guide');
  });

  it('22. new front-matter child with invalid YAML rejected', async () => {
    const doc = await seedDocument(FM_MD);
    const sections = doc.document!.sections;
    const rootSection = sections;

    // Write to root with a new front-matter child that has bad YAML.
    const fm = findStored(sections, (s) => s.type === 'front-matter')!;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;

    const input: WriteSectionInput = {
      id: rootSection.id,
      hash: rootSection.hash,
      children: [
        {
          id: fm.id,
          hash: fm.hash,
          type: 'front-matter',
          content: [{ type: 'code', value: 'title: ok\nversion: 1' }],
        },
        {
          id: guide.id,
          hash: guide.hash,
          content: [{ type: 'paragraph', value: 'Body text.' }],
        },
        {
          id: mintGuid(),
          type: 'front-matter',
          content: [{ type: 'code', value: '{{[ bad yaml' }],
        },
      ],
    };
    try {
      await writeSection(doc.id, input, 'replace', makeDeps());
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteSectionError);
      expect((e as WriteSectionError).code).toBe('invalid_yaml');
    }
  });
});

describe('writeSection: id normalisation', () => {
  it('23. valid 22-char base64url id on new node accepted', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;
    const install = findStored(sections, (s) => s.title === 'Install')!;
    const usage = findStored(sections, (s) => s.title === 'Usage')!;
    const validId = mintGuid(); // guaranteed valid 22-char base64url

    const input: WriteSectionInput = {
      id: guide.id,
      hash: guide.hash,
      content: [{ type: 'paragraph', value: 'Intro paragraph.' }],
      children: [
        {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Run `npm i`.' }],
        },
        {
          id: usage.id,
          hash: usage.hash,
          content: [{ type: 'paragraph', value: 'Call the CLI.' }],
        },
        {
          id: validId,
          type: 'section',
          title: 'Valid',
          content: [{ type: 'paragraph', value: 'New node.' }],
        },
      ],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });

  it('24. existing id passes without format check', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    // The existing id is already valid, but the point is the code path:
    // existing ids skip the isShortId check entirely.
    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{ type: 'paragraph', value: 'Updated.' }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    expect(result.digest).toBeDefined();
  });
});

describe('writeSection: serialisation', () => {
  it('25. type falls back to target type when absent from input',
    async () => {
      const doc = await seedDocument(SIMPLE_MD);
      const sections = doc.document!.sections;
      const install = findStored(sections, (s) => s.title === 'Install')!;
      expect(install.type).toBe('section');

      // Omit type from input, should inherit from target.
      const input: WriteSectionInput = {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'Kept type.' }],
      };
      const result = await writeSection(
        doc.id, input, 'replace', makeDeps(),
      );
      const updated = findStored(
        result.sections, (s) => s.title === 'Install',
      )!;
      expect(updated.type).toBe('section');
    });

  it('26. title falls back to target title when absent from input',
    async () => {
      const doc = await seedDocument(SIMPLE_MD);
      const sections = doc.document!.sections;
      const install = findStored(sections, (s) => s.title === 'Install')!;

      // Omit title from input, should inherit "Install".
      const input: WriteSectionInput = {
        id: install.id,
        hash: install.hash,
        content: [{ type: 'paragraph', value: 'New content.' }],
      };
      const result = await writeSection(
        doc.id, input, 'replace', makeDeps(),
      );
      const updated = findStored(
        result.sections, (s) => s.title === 'Install',
      )!;
      expect(updated).toBeDefined();
      expect(updated.title).toBe('Install');
    });

  it('27. new child depth = parent depth + 1', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const guide = findStored(sections, (s) => s.title === 'Guide')!;
    const install = findStored(sections, (s) => s.title === 'Install')!;
    const usage = findStored(sections, (s) => s.title === 'Usage')!;
    const newId = mintGuid();

    const input: WriteSectionInput = {
      id: guide.id,
      hash: guide.hash,
      content: [{ type: 'paragraph', value: 'Intro paragraph.' }],
      children: [
        {
          id: install.id,
          hash: install.hash,
          content: [{ type: 'paragraph', value: 'Run `npm i`.' }],
        },
        {
          id: usage.id,
          hash: usage.hash,
          content: [{ type: 'paragraph', value: 'Call the CLI.' }],
        },
        {
          id: newId,
          type: 'section',
          title: 'Appendix',
          content: [{ type: 'paragraph', value: 'Extra.' }],
        },
      ],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());
    // "Guide" is depth 1, so new child should be depth 2 -> ## heading.
    const masterPath = join(store.paths.artefactDir(doc.id), 'guide.md');
    const onDisk = await readFile(masterPath, 'utf8');
    expect(onDisk).toContain('## Appendix');
    // Verify the stored section has depth = guide.depth + 1.
    const appendix = findStored(
      result.sections, (s) => s.title === 'Appendix',
    )!;
    expect(appendix).toBeDefined();
    expect(appendix.depth).toBe(guide.depth + 1);
  });
});

describe('writeSection: round-trip', () => {
  it('28. write then read: updated sections and extracts', async () => {
    const doc = await seedDocument(SIMPLE_MD);
    const sections = doc.document!.sections;
    const install = findStored(sections, (s) => s.title === 'Install')!;

    const input: WriteSectionInput = {
      id: install.id,
      hash: install.hash,
      content: [{
        type: 'paragraph',
        value: 'Install the digest tool with pnpm. ' +
          'The digest tool processes markdown files. ' +
          'Digest uses a section tree to structure content.',
      }],
    };
    const result = await writeSection(doc.id, input, 'replace', makeDeps());

    // Read the digest back from the store.
    const reloaded = await store.readDigest(doc.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.document).toBeDefined();

    // Sections tree was persisted.
    const reloadedInstall = findStored(
      reloaded!.document!.sections, (s) => s.title === 'Install',
    )!;
    expect(reloadedInstall).toBeDefined();
    expect(reloadedInstall.content?.[0].value).toContain('digest tool');

    // Extracts (summary/keywords) were recomputed and persisted.
    expect(reloaded!.document!.summary).toBeDefined();
    // The updated_at timestamp should be set.
    expect(reloaded!.updated_at).toBeDefined();
  });
});
