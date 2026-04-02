import { describe, it, expect } from 'vitest';
import type { Digest } from '@digest/shared';
import {
  formatError, formatRedirect, jsonText, projectDocumentDigest, text,
} from './response.js';

const STAMP = '2026-06-13T10:00:00.000Z';
const HASH =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function documentDigest(): Digest {
  return {
    id: 'DDDDDDDDDDDDDDDDDDDDDD',
    type: 'document',
    origin_uri: 'https://ex.com/guide.md',
    created_at: STAMP,
    updated_at: STAMP,
    file: {
      name: 'guide.md',
      uri: 'file:///store/guide.md',
      hash: HASH,
      mime_type: 'text/markdown',
      size_bytes: 64,
      chunks: [{
        index: 0, uri: 'file:///store/chunks/0.md', hash: HASH,
        size_bytes: 32, chunk_meta: 'sections 1-2', created_at: STAMP,
      }],
    },
    document: {
      name: 'Guide',
      summary: 'A guide.',
      keywords: ['guide'],
      writable: 'full',
      source_file_hash: HASH,
      sections: {
        id: 'RRRRRRRRRRRRRRRRRRRRRR', type: 'root', depth: 0, index: 0,
        hash: HASH, created_at: STAMP,
        content: [{
          id: 'BBBBBBBBBBBBBBBBBBBBBB', index: 0, type: 'paragraph',
          value: 'Intro.', hash: HASH, created_at: STAMP,
        }],
        children: [{
          id: 'SSSSSSSSSSSSSSSSSSSSSS', type: 'section', depth: 1,
          index: 0, title: 'Install', hash: HASH, created_at: STAMP,
          content: [{
            id: 'CCCCCCCCCCCCCCCCCCCCCC', index: 0, type: 'code',
            value: 'npm i', meta: { lang: 'sh' }, hash: HASH,
            created_at: STAMP,
          }],
        }],
      },
    },
    related: [{ id: 'FFFFFFFFFFFFFFFFFFFFFF', type: 'converted_from' }],
  };
}

describe('projectDocumentDigest', () => {
  it('omits every uri and strips content arrays', () => {
    const out = projectDocumentDigest(documentDigest(), 'all', false);
    const json = JSON.stringify(out);
    expect(json).not.toContain('uri');
    expect(json).not.toContain('file://');
    expect(json).not.toContain('"content"');
    expect(json).not.toContain('"value"');
    // Identity, hashes and the tree survive.
    expect(json).toContain('"source_changed":false');
    expect(out).toMatchObject({
      id: 'DDDDDDDDDDDDDDDDDDDDDD',
      type: 'document',
      file: { name: 'guide.md', hash: HASH, size_bytes: 64 },
      related: [{ id: 'FFFFFFFFFFFFFFFFFFFFFF', type: 'converted_from' }],
    });
    const document = out.document as {
      sections: { children: { title: string }[] };
    };
    expect(document.sections.children[0].title).toBe('Install');
    // Chunk records keep identity fields, minus their uris.
    const file = out.file as { chunks: Record<string, unknown>[] };
    expect(file.chunks[0]).toEqual({
      index: 0, hash: HASH, size_bytes: 32, chunk_meta: 'sections 1-2',
      created_at: STAMP,
    });
  });

  it('meta_only drops sections, sections_only drops extracts', () => {
    const meta = projectDocumentDigest(documentDigest(), 'meta_only', false)
      .document as Record<string, unknown>;
    expect(meta.sections).toBeUndefined();
    expect(meta.summary).toBe('A guide.');
    expect(meta.keywords).toEqual(['guide']);

    const sections = projectDocumentDigest(
      documentDigest(), 'sections_only', false,
    ).document as Record<string, unknown>;
    expect(sections.sections).toBeTruthy();
    expect(sections.summary).toBeUndefined();
    expect(sections.keywords).toBeUndefined();
    expect(sections.name).toBe('Guide');
  });

  it('passes source_changed through', () => {
    const out = projectDocumentDigest(documentDigest(), 'all', true);
    expect(out.source_changed).toBe(true);
  });

  it('refuses a digest without a document branch', () => {
    const fileOnly = { ...documentDigest(), document: undefined };
    expect(() => projectDocumentDigest(fileOnly, 'all', false))
      .toThrow('no document branch');
  });

  it('preserves section meta fields in the projection', () => {
    const d = documentDigest();
    d.document!.sections.meta = { page_range: '1-3' };
    d.document!.sections.children![0].meta = {
      critic_rollup: { added: 2, removed: 1 },
    };
    const out = projectDocumentDigest(d, 'all', false);
    const doc = out.document as {
      sections: {
        meta?: Record<string, unknown>;
        children: { meta?: Record<string, unknown> }[];
      };
    };
    expect(doc.sections.meta).toEqual({ page_range: '1-3' });
    expect(doc.sections.children[0].meta).toEqual({
      critic_rollup: { added: 2, removed: 1 },
    });
  });

  it('stripContent recurses through 3+ level deep trees', () => {
    const d = documentDigest();
    // Add a grandchild section: Install -> Sub -> DeepSub.
    d.document!.sections.children![0].children = [{
      id: 'GGGGGGGGGGGGGGGGGGGGGG', type: 'section' as const,
      depth: 2, index: 0, title: 'Sub',
      hash: HASH,
      created_at: STAMP,
      content: [{
        id: 'HHHHHHHHHHHHHHHHHHHHHH', index: 0,
        type: 'paragraph' as const,
        value: 'Sub content.', hash: HASH,
        created_at: STAMP,
      }],
      children: [{
        id: 'IIIIIIIIIIIIIIIIIIIIII', type: 'section' as const,
        depth: 3, index: 0, title: 'DeepSub',
        hash: HASH,
        created_at: STAMP,
        content: [{
          id: 'JJJJJJJJJJJJJJJJJJJJJJ', index: 0,
          type: 'paragraph' as const,
          value: 'Deep content.', hash: HASH,
          created_at: STAMP,
        }],
      }],
    }];
    const out = projectDocumentDigest(d, 'all', false);
    const json = JSON.stringify(out);
    // No content anywhere in the tree.
    expect(json).not.toContain('"content"');
    expect(json).not.toContain('Sub content.');
    expect(json).not.toContain('Deep content.');
    // But structural fields survive at every level.
    expect(json).toContain('"Sub"');
    expect(json).toContain('"DeepSub"');
    expect(json).toContain('GGGGGGGGGGGGGGGGGGGGGG');
    expect(json).toContain('IIIIIIIIIIIIIIIIIIIIII');
  });
});

describe('text helpers', () => {
  it('wraps text and flags errors', () => {
    expect(text('hi')).toEqual({
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(text('bad', true).isError).toBe(true);
  });

  it('renders json results', () => {
    const out = jsonText({ a: 1 });
    expect(out.content[0].text).toBe('{\n  "a": 1\n}');
  });

  it('formats errors and redirects', () => {
    expect(formatError('https://x', 'boom'))
      .toBe('Error for https://x\nReason: boom');
    const redirect = formatRedirect('https://a/x', 'https://b/y');
    expect(redirect).toContain('From: https://a/x');
    expect(redirect).toContain('To: https://b/y');
  });
});
