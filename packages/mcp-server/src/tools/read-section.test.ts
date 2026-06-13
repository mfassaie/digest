import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtefactStore } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';
import type { ServerDeps } from '../deps.js';
import { handleFetchFile } from './fetch-file.js';
import { handleReadDocument } from './read-document.js';
import { handleReadSection } from './read-section.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'digest-trs-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';
const MD = [
  '# Guide', '', 'Intro paragraph about the guide.', '',
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

// Recursive section shape from the toc (read_document strips content).
interface TocSection {
  id: string;
  type: string;
  title?: string;
  children?: TocSection[];
}

// Helper: fetch + read_document to get a populated document artefact,
// then return its section tree for id extraction.
async function setupDocument(d: ServerDeps) {
  await handleFetchFile({ uri: MD_URL }, d);
  const readResult = await handleReadDocument({ resource: MD_URL }, d);
  const body = JSON.parse(readResult.content[0].text) as {
    id: string;
    document: { sections: TocSection };
  };
  return body;
}

// Walk the toc to find a section by title at any depth.
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

describe('handleReadSection', () => {
  it('returns a section with content blocks by id', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const sectionId = doc.document.sections.children![0].id;
    const out = await handleReadSection({
      artefact_id: doc.id, section_id: sectionId,
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      artefact_id: string;
      children_mode: string;
      sections: {
        id: string; title?: string;
        content?: { type: string; value: string }[];
      }[];
    };
    expect(body.artefact_id).toBe(doc.id);
    expect(body.children_mode).toBe('include');
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].id).toBe(sectionId);
    // Content blocks are attached (unlike read_document's toc).
    expect(body.sections[0].content).toBeDefined();
    expect(body.sections[0].content!.length).toBeGreaterThan(0);
  });

  it('accepts an array of section ids', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const children = doc.document.sections.children!;
    const ids = children.map((c) => c.id);
    const out = await handleReadSection({
      artefact_id: doc.id, section_id: ids,
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      sections: { id: string }[];
    };
    expect(body.sections).toHaveLength(ids.length);
    expect(body.sections.map((s) => s.id)).toEqual(ids);
  });

  it("children_mode 'exclude' omits descendants", async () => {
    const d = deps();
    const doc = await setupDocument(d);
    // Usage has an Advanced child (at depth 2 under Guide).
    const usageSection = findByTitle(doc.document.sections, 'Usage')!;
    expect(usageSection).toBeDefined();
    expect(usageSection.children).toBeDefined();

    const out = await handleReadSection({
      artefact_id: doc.id,
      section_id: usageSection.id,
      children_mode: 'exclude',
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      children_mode: string;
      sections: { id: string; children?: unknown }[];
    };
    expect(body.children_mode).toBe('exclude');
    expect(body.sections[0].children).toBeUndefined();
  });

  it("children_mode 'include' carries descendants with content",
    async () => {
      const d = deps();
      const doc = await setupDocument(d);
      const usageSection = findByTitle(doc.document.sections, 'Usage')!;
      expect(usageSection).toBeDefined();
      const out = await handleReadSection({
        artefact_id: doc.id,
        section_id: usageSection.id,
        children_mode: 'include',
      }, d);
      const body = JSON.parse(out.content[0].text) as {
        sections: {
          children?: {
            title?: string;
            content?: { value: string }[];
          }[];
        }[];
      };
      expect(body.sections[0].children).toBeDefined();
      expect(body.sections[0].children!.length).toBeGreaterThan(0);
      // Children carry content too.
      const advanced = body.sections[0].children![0];
      expect(advanced.title).toBe('Advanced');
      expect(advanced.content).toBeDefined();
    });

  it('errors on unknown section ids, listing valid ones', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const out = await handleReadSection({
      artefact_id: doc.id,
      section_id: 'ZZZZZZZZZZZZZZZZZZZZZZ',
    }, d);
    expect(out.isError).toBe(true);
    const message = out.content[0].text;
    expect(message).toContain('unknown section id(s)');
    expect(message).toContain('ZZZZZZZZZZZZZZZZZZZZZZ');
    // Lists valid ids so the caller can self-correct.
    expect(message).toContain('Valid ids');
    expect(message).toContain(doc.document.sections.id);
  });

  it('caps listed valid ids at 20 for large documents', async () => {
    // Generate markdown with 25 headings (root + 25 = 26 sections).
    const lines: string[] = [];
    for (let i = 1; i <= 25; i++) {
      lines.push(`## Section ${i}`, '', `Body of section ${i}.`, '');
    }
    const bigDoc = lines.join('\n');
    const d = deps(server(bigDoc));
    const doc = await setupDocument(d);

    const out = await handleReadSection({
      artefact_id: doc.id,
      section_id: 'ZZZZZZZZZZZZZZZZZZZZZZ',
    }, d);
    expect(out.isError).toBe(true);
    const message = out.content[0].text;
    expect(message).toContain('unknown section id(s)');

    // 26 valid ids (root + 25 headings) > 20 cap.
    expect(message).toContain('and 6 more');
    expect(message).toContain('read_document');

    // Count comma-separated ids listed before the "..." truncation.
    const idsMatch = message.match(/Valid ids in this artefact: (.+?)\.\.\./)!;
    expect(idsMatch).not.toBeNull();
    const listedIds = idsMatch[1].split(', ');
    expect(listedIds).toHaveLength(20);
  });

  it('errors when some ids in a batch are unknown', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const goodId = doc.document.sections.children![0].id;
    const out = await handleReadSection({
      artefact_id: doc.id,
      section_id: [goodId, 'BADIDBADIDBADIDBADIDBA'],
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('BADIDBADIDBADIDBADIDBA');
    // The good id should NOT appear in the unknown list.
    expect(out.content[0].text).not.toContain(
      `unknown section id(s): ${goodId}`,
    );
  });

  it('errors on unknown artefact id', async () => {
    const d = deps();
    const out = await handleReadSection({
      artefact_id: 'AAAAAAAAAAAAAAAAAAAAAA',
      section_id: 'BBBBBBBBBBBBBBBBBBBBBB',
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('unknown artefact id');
  });

  it('errors on a file-type artefact (not a document)', async () => {
    const d = deps();
    await handleFetchFile({ uri: MD_URL }, d);
    // The file artefact id is different from the document one.
    const fetchResult = await handleFetchFile({ uri: MD_URL }, d);
    const fileDigest = JSON.parse(fetchResult.content[0].text) as {
      id: string;
    };
    const out = await handleReadSection({
      artefact_id: fileDigest.id,
      section_id: 'BBBBBBBBBBBBBBBBBBBBBB',
    }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('not a document artefact');
  });

  it('flags oversized single sections with truncated and child_ids',
    async () => {
      // Big content before any heading lands in root's own content.
      // A child heading gives root children for the child_ids pointer.
      const bigValue = 'x'.repeat(60_000);
      const bigMd = `${bigValue}\n\n# Section\n\nSmall.\n`;
      const d = deps(server(bigMd));
      await handleFetchFile({ uri: MD_URL }, d);
      const readResult = await handleReadDocument(
        { resource: MD_URL }, d,
      );
      const doc = JSON.parse(readResult.content[0].text) as {
        id: string;
        document: { sections: TocSection };
      };
      const rootId = doc.document.sections.id;
      const out = await handleReadSection({
        artefact_id: doc.id, section_id: rootId,
      }, d);
      expect(out.isError).toBeUndefined();
      const body = JSON.parse(out.content[0].text) as {
        sections: {
          truncated?: boolean;
          content?: unknown;
          child_ids?: string[];
          children?: unknown;
        }[];
      };
      const section = body.sections[0];
      expect(section.truncated).toBe(true);
      expect(section.content).toBeUndefined();
      expect(section.children).toBeUndefined();
      expect(section.child_ids).toBeDefined();
      expect(section.child_ids!.length).toBeGreaterThan(0);
    });

  it('returns the root section (including the root id)', async () => {
    const d = deps();
    const doc = await setupDocument(d);
    const rootId = doc.document.sections.id;
    const out = await handleReadSection({
      artefact_id: doc.id, section_id: rootId,
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      sections: { id: string; type: string }[];
    };
    expect(body.sections[0].type).toBe('root');
    expect(body.sections[0].id).toBe(rootId);
  });

  it('oversized section with zero children omits child_ids entirely',
    async () => {
      // A single big paragraph with no headings: the root section has
      // content above the threshold but no children at all.
      const bigValue = 'x'.repeat(60_000);
      const bigMd = bigValue;
      const d = deps(server(bigMd));
      await handleFetchFile({ uri: MD_URL }, d);
      const readResult = await handleReadDocument(
        { resource: MD_URL }, d,
      );
      const doc = JSON.parse(readResult.content[0].text) as {
        id: string;
        document: { sections: TocSection };
      };
      const rootId = doc.document.sections.id;
      // Root should have no children in this document.
      expect(doc.document.sections.children).toBeUndefined();

      const out = await handleReadSection({
        artefact_id: doc.id, section_id: rootId,
      }, d);
      expect(out.isError).toBeUndefined();
      const body = JSON.parse(out.content[0].text) as {
        sections: {
          truncated?: boolean;
          content?: unknown;
          children?: unknown;
          child_ids?: string[];
        }[];
      };
      const section = body.sections[0];
      expect(section.truncated).toBe(true);
      expect(section.content).toBeUndefined();
      // child_ids must be absent (not an empty array) when there are
      // no children.
      expect(section.child_ids).toBeUndefined();
      expect('child_ids' in section).toBe(false);
    });

  it('batch requests skip oversized truncation', async () => {
    // The oversize guard only fires for requestedIds.length === 1.
    // A batch request should return full content even for large sections.
    const bigValue = 'x'.repeat(60_000);
    const bigMd = `${bigValue}\n\n# Section\n\nSmall.\n`;
    const d = deps(server(bigMd));
    await handleFetchFile({ uri: MD_URL }, d);
    const readResult = await handleReadDocument(
      { resource: MD_URL }, d,
    );
    const doc = JSON.parse(readResult.content[0].text) as {
      id: string;
      document: { sections: TocSection };
    };
    const rootId = doc.document.sections.id;
    const childId = doc.document.sections.children![0].id;

    const out = await handleReadSection({
      artefact_id: doc.id, section_id: [rootId, childId],
    }, d);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as {
      sections: {
        id: string;
        truncated?: boolean;
        content?: unknown[];
      }[];
    };
    expect(body.sections).toHaveLength(2);
    // Root has oversized content but is NOT truncated in a batch.
    const rootSection = body.sections.find((s) => s.id === rootId)!;
    expect(rootSection.truncated).toBeUndefined();
    expect(rootSection.content).toBeDefined();
  });

  it('preserves meta field on a section through projectSection',
    async () => {
      // Build a markdown document, then patch a section's meta in the
      // store to verify projectSection passes it through.
      const d = deps();
      const doc = await setupDocument(d);
      const installId = doc.document.sections.children![0].id;

      // Inject a meta field onto the Install section.
      await d.store.updateDigest(doc.id, {
        mutate: (digest) => {
          const install = digest.document!.sections.children![0];
          (install as { meta?: Record<string, unknown> }).meta = {
            page_range: '3-5',
          };
        },
      });

      const out = await handleReadSection({
        artefact_id: doc.id, section_id: installId,
      }, d);
      expect(out.isError).toBeUndefined();
      const body = JSON.parse(out.content[0].text) as {
        sections: { id: string; meta?: Record<string, unknown> }[];
      };
      expect(body.sections[0].meta).toEqual({ page_range: '3-5' });
    });
});
