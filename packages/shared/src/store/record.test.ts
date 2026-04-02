import { describe, it, expect } from 'vitest';
import { hashBytes } from './hash.js';
import { artefactId, mintGuid } from './ids.js';
import {
  ArtefactIndexEntrySchema, ArtefactIndexSchema, DigestSchema,
  buildArtefactIndexJsonSchema, buildDigestJsonSchema,
  type ArtefactIndexEntry, type Digest, type WritableCapability,
} from './record.js';

const T0 = '2026-06-13T10:00:00.000Z';
const T1 = '2026-06-13T11:00:00.000Z';
const URI = 'https://docs.foo.dev/guide.md';

// A maximal document Digest exercising every field of design §2.2.
function maximalDigest(): Digest {
  return {
    id: artefactId(URI, 'document'),
    type: 'document',
    origin_uri: URI,
    created_at: T0,
    updated_at: T1,
    file: {
      name: 'guide.md',
      uri: 'file:///tmp/artefact/x/guide.md',
      hash: hashBytes('master md'),
      mime_type: 'text/markdown',
      size_bytes: 9,
      chunks: [{
        index: 0,
        uri: 'file:///tmp/artefact/x/chunks/part-0.md',
        hash: hashBytes('chunk 0'),
        size_bytes: 7,
        chunk_meta: 'sections 1-4',
        created_at: T0,
        updated_at: T1,
      }],
    },
    document: {
      name: 'Guide',
      summary: 'A guide.',
      keywords: ['guide', 'docs'],
      writable: 'full',
      source_file_hash: hashBytes('raw html'),
      sections: {
        id: mintGuid(),
        type: 'root',
        depth: 0,
        index: 0,
        title: 'Guide',
        meta: { page_range: '1-2', critic_rollup: { ins: 1 } },
        hash: hashBytes('section root'),
        created_at: T0,
        updated_at: T1,
        content: [{
          id: mintGuid(),
          index: 0,
          type: 'code',
          value: 'const a = 1;',
          meta: { lang: 'ts' },
          hash: hashBytes('block 0'),
          created_at: T0,
          updated_at: T1,
        }],
        children: [{
          id: mintGuid(),
          type: 'section',
          depth: 1,
          index: 0,
          title: 'Install',
          hash: hashBytes('section install'),
          created_at: T0,
          content: [{
            id: mintGuid(),
            index: 0,
            type: 'paragraph',
            value: 'Run pnpm i.',
            hash: hashBytes('block install'),
            created_at: T0,
          }],
        }],
      },
    },
    related: [
      { id: artefactId(URI, 'file'), type: 'converted_from' },
    ],
  };
}

function minimalFileDigest(): Digest {
  return {
    id: artefactId(URI, 'file'),
    type: 'file',
    origin_uri: URI,
    created_at: T0,
    file: {
      name: 'guide.md',
      uri: 'file:///tmp/artefact/y/guide.md',
      hash: hashBytes('raw'),
      mime_type: 'text/markdown',
      size_bytes: 3,
    },
  };
}

describe('DigestSchema', () => {
  it('parses a maximal document digest unchanged', () => {
    const digest = maximalDigest();
    expect(DigestSchema.parse(digest)).toEqual(digest);
  });

  it('parses a minimal file digest', () => {
    const digest = minimalFileDigest();
    expect(DigestSchema.parse(digest)).toEqual(digest);
  });

  it('matches design §2.2 field for field at every level', () => {
    const d = DigestSchema.parse(maximalDigest());
    expect(Object.keys(d).sort()).toEqual([
      'created_at', 'document', 'file', 'id', 'origin_uri', 'related',
      'type', 'updated_at',
    ]);
    expect(Object.keys(d.file).sort()).toEqual([
      'chunks', 'hash', 'mime_type', 'name', 'size_bytes', 'uri',
    ]);
    expect(Object.keys(d.file.chunks![0]).sort()).toEqual([
      'chunk_meta', 'created_at', 'hash', 'index', 'size_bytes',
      'updated_at', 'uri',
    ]);
    expect(Object.keys(d.document!).sort()).toEqual([
      'keywords', 'name', 'sections', 'source_file_hash', 'summary',
      'writable',
    ]);
    expect(Object.keys(d.document!.sections).sort()).toEqual([
      'children', 'content', 'created_at', 'depth', 'hash', 'id', 'index',
      'meta', 'title', 'type', 'updated_at',
    ]);
    expect(Object.keys(d.document!.sections.content![0]).sort()).toEqual([
      'created_at', 'hash', 'id', 'index', 'meta', 'type', 'updated_at',
      'value',
    ]);
    expect(Object.keys(d.related![0]).sort()).toEqual(['id', 'type']);
  });

  it('requires the document branch on document artefacts', () => {
    const digest = { ...maximalDigest(), document: undefined };
    expect(DigestSchema.safeParse(digest).success).toBe(false);
  });

  it('forbids a document branch on file artefacts', () => {
    const digest = {
      ...minimalFileDigest(),
      document: maximalDigest().document,
    };
    expect(DigestSchema.safeParse(digest).success).toBe(false);
  });

  it('rejects hashes without the sha256 prefix', () => {
    const digest = minimalFileDigest();
    digest.file.hash = 'a'.repeat(64);
    expect(DigestSchema.safeParse(digest).success).toBe(false);
  });

  it('rejects ids that are not 22-char base64url', () => {
    const digest = { ...minimalFileDigest(), id: 'not-an-id' };
    expect(DigestSchema.safeParse(digest).success).toBe(false);
  });

  it('rejects unknown section and block types', () => {
    const digest = maximalDigest();
    (digest.document!.sections as { type: string }).type = 'chapter';
    expect(DigestSchema.safeParse(digest).success).toBe(false);
    const other = maximalDigest();
    (other.document!.sections.content![0] as { type: string }).type = 'gif';
    expect(DigestSchema.safeParse(other).success).toBe(false);
  });

  it('rejects negative indexes and missing created_at', () => {
    const digest = maximalDigest();
    digest.document!.sections.content![0].index = -1;
    expect(DigestSchema.safeParse(digest).success).toBe(false);
    const other = maximalDigest();
    delete (other.document!.sections as { created_at?: string }).created_at;
    expect(DigestSchema.safeParse(other).success).toBe(false);
  });

  it('rejects non-ISO timestamps', () => {
    const digest = { ...minimalFileDigest(), created_at: '13-06-2026' };
    expect(DigestSchema.safeParse(digest).success).toBe(false);
  });

  it('accepts every writable capability form', () => {
    const variants: WritableCapability[] = ['full', 'none', ['form-field']];
    for (const writable of variants) {
      const digest = maximalDigest();
      digest.document!.writable = writable;
      expect(DigestSchema.safeParse(digest).success).toBe(true);
    }
    const bad = maximalDigest();
    (bad.document! as { writable: string }).writable = 'partial';
    expect(DigestSchema.safeParse(bad).success).toBe(false);
  });

  it('passes unknown meta keys through (open meta objects)', () => {
    const digest = maximalDigest();
    (digest.document!.sections.meta as Record<string, unknown>).custom = 1;
    (digest.document!.sections.content![0].meta as
      Record<string, unknown>).why = 'x';
    const parsed = DigestSchema.parse(digest);
    expect(parsed.document!.sections.meta).toMatchObject({ custom: 1 });
    expect(parsed.document!.sections.content![0].meta)
      .toMatchObject({ why: 'x' });
  });
});

describe('ArtefactIndexEntrySchema', () => {
  const fileEntry: ArtefactIndexEntry = {
    artefact_id: artefactId(URI, 'file'),
    artefact_type: 'file',
    origin_uri: URI,
    origin_etag: 'W/"abc"',
    fresh_until: T1,
    last_modified: 'Wed, 21 Oct 2015 07:28:00 GMT',
    last_fetched: T0,
    created_at: T0,
    updated_at: T1,
  };

  it('parses a full file entry unchanged', () => {
    expect(ArtefactIndexEntrySchema.parse(fileEntry)).toEqual(fileEntry);
  });

  it('matches design §2.1 field for field', () => {
    expect(Object.keys(ArtefactIndexEntrySchema.parse(fileEntry)).sort())
      .toEqual([
        'artefact_id', 'artefact_type', 'created_at', 'fresh_until',
        'last_fetched', 'last_modified', 'origin_etag', 'origin_uri',
        'updated_at',
      ]);
  });

  it('accepts document entries without web cache state', () => {
    const entry: ArtefactIndexEntry = {
      artefact_id: artefactId(URI, 'document'),
      artefact_type: 'document',
      origin_uri: URI,
      created_at: T0,
    };
    expect(ArtefactIndexEntrySchema.parse(entry)).toEqual(entry);
  });

  it('rejects web cache fields on document entries', () => {
    const entry = {
      artefact_id: artefactId(URI, 'document'),
      artefact_type: 'document',
      origin_uri: URI,
      origin_etag: 'W/"abc"',
      created_at: T0,
    };
    expect(ArtefactIndexEntrySchema.safeParse(entry).success).toBe(false);
  });

  it('ArtefactIndexSchema is an array of entries', () => {
    expect(ArtefactIndexSchema.parse([fileEntry])).toEqual([fileEntry]);
    expect(ArtefactIndexSchema.safeParse({ entries: [] }).success)
      .toBe(false);
  });
});

describe('generated JSON schemas', () => {
  it('digest.schema.json covers the record incl. the recursive tree', () => {
    const schema = buildDigestJsonSchema() as {
      $schema: string;
      required: string[];
      properties: Record<string, unknown>;
      $defs: Record<string, unknown>;
    };
    expect(schema.$schema).toContain('2020-12');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining([
        'id', 'type', 'origin_uri', 'created_at', 'updated_at', 'file',
        'document', 'related',
      ]),
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(['id', 'type', 'origin_uri', 'created_at',
        'file']),
    );
    // The recursive section tree resolves through $defs.
    expect(schema.$defs).toHaveProperty('document_section');
  });

  it('artefact-index.schema.json is an array schema of entries', () => {
    const schema = buildArtefactIndexJsonSchema() as {
      $schema: string;
      type: string;
      items: { properties: Record<string, unknown> };
    };
    expect(schema.$schema).toContain('2020-12');
    expect(schema.type).toBe('array');
    expect(Object.keys(schema.items.properties)).toEqual(
      expect.arrayContaining([
        'artefact_id', 'artefact_type', 'origin_uri', 'origin_etag',
        'fresh_until', 'last_modified', 'last_fetched', 'created_at',
      ]),
    );
  });
});
