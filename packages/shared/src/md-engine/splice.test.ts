import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './fold.js';
import { replaceByteRange, spliceMarkdown } from './splice.js';
import type { DocumentSection } from './types.js';
import { findSection } from './walk.js';

function byTitle(root: DocumentSection, title: string): DocumentSection {
  const found = findSection(root, (s) => s.title === title);
  expect(found, `section '${title}'`).toBeDefined();
  return found!;
}

const DOC = [
  '# One', '', 'Alpha *kept verbatim*, with {==a critic mark==}.', '',
  '# Two', '', 'Beta.', '', '```ts', '# trap', '```', '',
  '# Three', '', 'Gamma 中文 😀.', '',
].join('\n');

describe('replaceByteRange', () => {
  it('replaces the range and nothing else', () => {
    expect(replaceByteRange('abcdef', 2, 4, 'XY')).toBe('abXYef');
    expect(replaceByteRange('abcdef', 2, 4, '')).toBe('abef');
    expect(replaceByteRange('abc', 3, 3, 'Z')).toBe('abcZ');
  });

  it('rejects out-of-range and non-integer offsets', () => {
    expect(() => replaceByteRange('abc', -1, 2, 'x')).toThrow(RangeError);
    expect(() => replaceByteRange('abc', 2, 1, 'x')).toThrow(RangeError);
    expect(() => replaceByteRange('abc', 0, 4, 'x')).toThrow(RangeError);
    expect(() => replaceByteRange('abc', 0.5, 1, 'x')).toThrow(RangeError);
  });

  it('rejects offsets inside a multi-byte UTF-8 sequence', () => {
    // '中' is 3 bytes (e4 b8 ad) starting at byte 0.
    expect(() => replaceByteRange('中文', 1, 3, 'x')).toThrow(
      /multi-byte/,
    );
    expect(() => replaceByteRange('中文', 0, 2, 'x')).toThrow(
      /multi-byte/,
    );
    expect(replaceByteRange('中文', 0, 3, 'x')).toBe('x文');
  });
});

describe('spliceMarkdown: byte identity', () => {
  it('keeps every byte outside [start, end) identical', () => {
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const replacement = '# Two\n\nRewritten body.\n\n## Two A\n\nNew child.';
    const { markdown } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end, replacement,
    });

    const before = Buffer.from(DOC, 'utf8');
    const after = Buffer.from(markdown, 'utf8');
    const replBytes = Buffer.byteLength(replacement);
    // untouched prefix: byte-equal
    expect(after.subarray(0, two.position.start)
      .equals(before.subarray(0, two.position.start))).toBe(true);
    // untouched suffix (covers the multi-byte 中文/😀 region): byte-equal
    expect(after.subarray(two.position.start + replBytes)
      .equals(before.subarray(two.position.end))).toBe(true);
    // the range itself is the replacement, verbatim
    expect(after.subarray(
      two.position.start, two.position.start + replBytes,
    ).toString('utf8')).toBe(replacement);
    // critic mark in an untouched region survives unmangled (C1)
    expect(markdown).toContain('{==a critic mark==}');
  });

  it('re-matches untouched section ids and leaves their hashes equal', () => {
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const { root } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end,
      replacement: '# Two\n\nRewritten.\n\n## Two A\n\nChild.',
    });
    for (const title of ['One', 'Three']) {
      expect(byTitle(root, title).id).toBe(byTitle(prev, title).id);
      expect(byTitle(root, title).hash).toBe(byTitle(prev, title).hash);
    }
    expect(root.id).toBe(prev.id);
    // the edited section keeps its id (title match) with a new hash
    expect(byTitle(root, 'Two').id).toBe(two.id);
    expect(byTitle(root, 'Two').hash).not.toBe(two.hash);
    // the new child is a new node
    const twoA = byTitle(root, 'Two A');
    expect(twoA.id).not.toBe(two.id);
  });

  it('updates positions for sections after the splice point', () => {
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const replacement = '# Two\n\nMuch longer body than before, shifting '
      + 'everything after it.';
    const { markdown, root } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end, replacement,
    });
    const three = byTitle(root, 'Three');
    const slice = Buffer.from(markdown, 'utf8')
      .subarray(three.position.start, three.position.end).toString('utf8');
    expect(slice).toBe('# Three\n\nGamma 中文 😀.');
    expect(three.id).toBe(byTitle(prev, 'Three').id);
  });

  it('deletes a section with an empty replacement, retiring its id', () => {
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const { markdown, root } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end, replacement: '',
    });
    expect(markdown).not.toContain('Beta.');
    expect(findSection(root, (s) => s.title === 'Two')).toBeUndefined();
    expect(findSection(root, (s) => s.id === two.id)).toBeUndefined();
    expect(byTitle(root, 'Three').id).toBe(byTitle(prev, 'Three').id);
  });

  it('stamps new nodes when now is given', () => {
    const t = '2026-06-13T12:00:00.000Z';
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const { root } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end,
      replacement: '# Two\n\nBody.\n\n## Two A\n\nChild.',
    }, { now: t });
    expect(byTitle(root, 'Two A').created_at).toBe(t);
    expect(byTitle(root, 'Two').updated_at).toBe(t);
    expect(byTitle(root, 'One').updated_at).toBeUndefined();
  });

  it('round-trips a no-op splice to the identical document', () => {
    const prev = parseMarkdown(DOC);
    const two = byTitle(prev, 'Two');
    const original = Buffer.from(DOC, 'utf8')
      .subarray(two.position.start, two.position.end).toString('utf8');
    const { markdown, root } = spliceMarkdown(DOC, prev, {
      start: two.position.start, end: two.position.end,
      replacement: original,
    });
    expect(Buffer.from(markdown).equals(Buffer.from(DOC))).toBe(true);
    expect(byTitle(root, 'Two').id).toBe(two.id);
    expect(byTitle(root, 'Two').hash).toBe(two.hash);
  });

  it('splices correctly in a document with multi-byte prefixes', () => {
    const md = '# Tête\n\nCafé ☕ 中文 😀.\n\n# Deux\n\nCorps.\n';
    const prev = parseMarkdown(md);
    const deux = byTitle(prev, 'Deux');
    const { markdown, root } = spliceMarkdown(md, prev, {
      start: deux.position.start, end: deux.position.end,
      replacement: '# Deux\n\nNouveau corps.',
    });
    expect(markdown).toBe('# Tête\n\nCafé ☕ 中文 😀.\n\n# Deux\n\n'
      + 'Nouveau corps.\n');
    expect(byTitle(root, 'Tête').id).toBe(byTitle(prev, 'Tête').id);
    expect(byTitle(root, 'Tête').hash).toBe(byTitle(prev, 'Tête').hash);
  });
});
