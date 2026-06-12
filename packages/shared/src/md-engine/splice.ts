import { parseMarkdown } from './fold.js';
import { rematchIds } from './rematch.js';
import type { DocumentSection } from './types.js';

// The write primitive (design §5.2): replace byte range [start, end) of
// the master markdown with new markdown spliced VERBATIM — no whole-
// document re-serialisation, so bytes outside the range are untouched by
// construction. That is what keeps CriticMarkup and unusual-but-valid
// syntax in untouched regions intact (§5.5 C1) and what the byte-identity
// tests pin.

export interface SpliceEdit {
  start: number; // inclusive UTF-8 byte offset
  end: number; // exclusive UTF-8 byte offset
  replacement: string;
}

export interface SpliceResult {
  markdown: string;
  root: DocumentSection; // re-parsed, ids re-matched, hashes recomputed
}

export function replaceByteRange(
  markdown: string, start: number, end: number, replacement: string,
): string {
  const bytes = Buffer.from(markdown, 'utf8');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0
    || end < start || end > bytes.length) {
    throw new RangeError(
      `md-engine: splice range [${start}, ${end}) invalid for a `
      + `${bytes.length}-byte document`,
    );
  }
  // A boundary inside a multi-byte UTF-8 sequence would mangle the
  // neighbouring character into replacement glyphs — reject loudly.
  for (const offset of [start, end]) {
    if (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) {
      throw new RangeError(
        `md-engine: splice offset ${offset} falls inside a multi-byte `
        + 'UTF-8 sequence',
      );
    }
  }
  return Buffer.concat([
    bytes.subarray(0, start),
    Buffer.from(replacement, 'utf8'),
    bytes.subarray(end),
  ]).toString('utf8');
}

// Splice -> re-parse -> re-match ids against the previous tree (hashes are
// recomputed by the fold itself). `previous` is the tree the byte range
// came from; positions must come from a fresh parse of `markdown` (plan
// §6 risk rule).
export function spliceMarkdown(
  markdown: string, previous: DocumentSection, edit: SpliceEdit,
  opts: { now?: string } = {},
): SpliceResult {
  const next = replaceByteRange(
    markdown, edit.start, edit.end, edit.replacement,
  );
  const root = rematchIds(previous, parseMarkdown(next), { now: opts.now });
  return { markdown: next, root };
}
