import type { DocumentSection } from '../md-engine/types.js';
import { matchMimePattern } from '../settings/resolve.js';
import type { ChunkStrategy, Settings } from '../settings/schema.js';

// Standard chunker (plan M8, design §2.2): per-type strategy from settings.
// Markdown splits by top-level sections (fold output carries byte positions);
// everything else splits into fixed-size byte ranges. The chunker returns
// descriptors only; callers slice the content and write via store.writeChunk.

export interface ChunkDescriptor {
  index: number;
  byteStart: number;
  byteEnd: number;
  chunkMeta: string;
}

// Resolve the chunking strategy for a MIME type from settings. Falls through
// exact > type/* > */* the same way type rules do (matchMimePattern).
export function resolveChunkStrategy(
  settings: Settings, mime: string,
): ChunkStrategy {
  const strategy = matchMimePattern(settings.chunking.standard, mime);
  // DEFAULT_SETTINGS always carries */* so this should never happen, but
  // defend against a stripped settings object.
  if (strategy === undefined) {
    return { strategy: 'bytes', chunk_bytes: 1_048_576 };
  }
  return strategy;
}

// Plan the chunks for a file. Returns an empty array when the content is
// empty. For markdown with strategy 'sections', top-level sections from
// the fold output drive the split. For everything else (or when no
// sections are available), fixed-size byte ranges.
export function planChunks(
  contentBytes: number,
  strategy: ChunkStrategy,
  sections?: DocumentSection[],
): ChunkDescriptor[] {
  if (contentBytes === 0) return [];

  if (strategy.strategy === 'sections' && sections !== undefined) {
    return planSectionChunks(contentBytes, sections);
  }

  return planByteChunks(contentBytes, strategy.strategy === 'bytes'
    ? strategy.chunk_bytes : 1_048_576);
}

// Section-based chunking: each top-level section (depth 1 child of root)
// becomes one chunk. Any preamble content before the first section is
// included in chunk 0; if there are no sections the whole document is one
// chunk.
function planSectionChunks(
  totalBytes: number,
  sections: DocumentSection[],
): ChunkDescriptor[] {
  // Top-level sections: direct children of root (depth 1). The fold
  // output is already the root; its children are the top-level sections.
  const topLevel = sections.filter((s) => s.type !== 'front-matter');
  if (topLevel.length === 0) {
    return [{
      index: 0,
      byteStart: 0,
      byteEnd: totalBytes,
      chunkMeta: 'full document',
    }];
  }

  const chunks: ChunkDescriptor[] = [];
  let idx = 0;

  // Preamble: bytes before the first top-level section.
  const firstStart = topLevel[0]!.position.start;
  if (firstStart > 0) {
    chunks.push({
      index: idx++,
      byteStart: 0,
      byteEnd: firstStart,
      chunkMeta: 'preamble',
    });
  }

  // One chunk per top-level section. End of each section extends to the
  // start of the next one (so inter-section whitespace belongs to the
  // preceding section). The last section extends to EOF.
  for (let i = 0; i < topLevel.length; i++) {
    const section = topLevel[i]!;
    const byteStart = section.position.start;
    const byteEnd = i + 1 < topLevel.length
      ? topLevel[i + 1]!.position.start
      : totalBytes;
    const label = section.title ?? `section ${i + 1}`;
    chunks.push({ index: idx++, byteStart, byteEnd, chunkMeta: label });
  }

  return chunks;
}

// Byte-range chunking: fixed-size slices. The last chunk may be smaller.
function planByteChunks(
  totalBytes: number,
  chunkBytes: number,
): ChunkDescriptor[] {
  const chunks: ChunkDescriptor[] = [];
  let offset = 0;
  let idx = 0;
  while (offset < totalBytes) {
    const end = Math.min(offset + chunkBytes, totalBytes);
    chunks.push({
      index: idx,
      byteStart: offset,
      byteEnd: end,
      chunkMeta: `bytes ${offset}-${end - 1}`,
    });
    offset = end;
    idx++;
  }
  return chunks;
}
