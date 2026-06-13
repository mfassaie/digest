import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import type { ChunkStrategy } from '../settings/schema.js';
import type { DocumentSection } from '../md-engine/types.js';
import { planChunks, resolveChunkStrategy } from './chunker.js';

// Minimal section stub with only the fields planChunks reads.
function section(
  overrides: Partial<DocumentSection> & { position: { start: number; end: number } },
): DocumentSection {
  return {
    id: 'x', type: 'section', depth: 1, index: 0, hash: '',
    ...overrides,
  };
}

describe('resolveChunkStrategy', () => {
  it('resolves text/markdown to sections', () => {
    const s = resolveChunkStrategy(DEFAULT_SETTINGS, 'text/markdown');
    expect(s.strategy).toBe('sections');
  });

  it('resolves unknown types to bytes via */*', () => {
    const s = resolveChunkStrategy(DEFAULT_SETTINGS, 'application/pdf');
    expect(s.strategy).toBe('bytes');
    if (s.strategy === 'bytes') {
      expect(s.chunk_bytes).toBe(1_048_576);
    }
  });

  it('falls back to bytes when settings have no chunking map', () => {
    const empty = {
      ...DEFAULT_SETTINGS,
      chunking: { standard: {} },
    };
    const s = resolveChunkStrategy(empty, 'text/markdown');
    expect(s.strategy).toBe('bytes');
  });
});

describe('planChunks — section strategy', () => {
  const sectionsStrategy: ChunkStrategy = { strategy: 'sections' };

  it('splits by top-level sections', () => {
    const sections: DocumentSection[] = [
      section({
        title: 'Introduction',
        position: { start: 0, end: 50 },
      }),
      section({
        title: 'Details', index: 1,
        position: { start: 50, end: 120 },
      }),
      section({
        title: 'Conclusion', index: 2,
        position: { start: 120, end: 200 },
      }),
    ];
    const chunks = planChunks(200, sectionsStrategy, sections);
    expect(chunks).toEqual([
      { index: 0, byteStart: 0, byteEnd: 50, chunkMeta: 'Introduction' },
      { index: 1, byteStart: 50, byteEnd: 120, chunkMeta: 'Details' },
      { index: 2, byteStart: 120, byteEnd: 200, chunkMeta: 'Conclusion' },
    ]);
  });

  it('creates a preamble chunk for content before the first section', () => {
    const sections: DocumentSection[] = [
      section({
        title: 'First',
        position: { start: 30, end: 100 },
      }),
    ];
    const chunks = planChunks(100, sectionsStrategy, sections);
    expect(chunks).toEqual([
      { index: 0, byteStart: 0, byteEnd: 30, chunkMeta: 'preamble' },
      { index: 1, byteStart: 30, byteEnd: 100, chunkMeta: 'First' },
    ]);
  });

  it('excludes front-matter sections', () => {
    const sections: DocumentSection[] = [
      section({
        type: 'front-matter', depth: 1,
        position: { start: 0, end: 20 },
      }),
      section({
        title: 'Body', index: 1,
        position: { start: 20, end: 100 },
      }),
    ];
    const chunks = planChunks(100, sectionsStrategy, sections);
    // Front-matter is skipped; preamble covers bytes 0-20, then the
    // section covers 20-100.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.chunkMeta).toBe('preamble');
    expect(chunks[1]!.chunkMeta).toBe('Body');
  });

  it('returns one chunk for empty sections array', () => {
    const chunks = planChunks(50, sectionsStrategy, []);
    expect(chunks).toEqual([
      { index: 0, byteStart: 0, byteEnd: 50, chunkMeta: 'full document' },
    ]);
  });

  it('labels untitled sections with a positional name', () => {
    const sections: DocumentSection[] = [
      section({ position: { start: 0, end: 40 } }),
      section({ index: 1, position: { start: 40, end: 80 } }),
    ];
    const chunks = planChunks(80, sectionsStrategy, sections);
    expect(chunks[0]!.chunkMeta).toBe('section 1');
    expect(chunks[1]!.chunkMeta).toBe('section 2');
  });

  it('returns empty for zero bytes', () => {
    expect(planChunks(0, sectionsStrategy, [])).toEqual([]);
  });

  it('falls back to byte-range when sections are undefined', () => {
    const chunks = planChunks(100, sectionsStrategy, undefined);
    // Without sections, falls through to byte-range at default 1 MiB,
    // which means the whole 100-byte file is one chunk.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkMeta).toBe('bytes 0-99');
  });
});

describe('planChunks — bytes strategy', () => {
  const bytesStrategy: ChunkStrategy = {
    strategy: 'bytes', chunk_bytes: 100,
  };

  it('splits into fixed-size ranges', () => {
    const chunks = planChunks(250, bytesStrategy);
    expect(chunks).toEqual([
      { index: 0, byteStart: 0, byteEnd: 100, chunkMeta: 'bytes 0-99' },
      { index: 1, byteStart: 100, byteEnd: 200, chunkMeta: 'bytes 100-199' },
      { index: 2, byteStart: 200, byteEnd: 250, chunkMeta: 'bytes 200-249' },
    ]);
  });

  it('produces a single chunk when file is smaller than chunk_bytes', () => {
    const chunks = planChunks(50, bytesStrategy);
    expect(chunks).toEqual([
      { index: 0, byteStart: 0, byteEnd: 50, chunkMeta: 'bytes 0-49' },
    ]);
  });

  it('handles exact multiples cleanly', () => {
    const chunks = planChunks(200, bytesStrategy);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.byteEnd).toBe(200);
  });

  it('returns empty for zero bytes', () => {
    expect(planChunks(0, bytesStrategy)).toEqual([]);
  });
});
