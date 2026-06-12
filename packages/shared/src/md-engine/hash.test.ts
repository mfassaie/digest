import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './fold.js';
import { blockHash, sectionHash } from './hash.js';
import { findSection } from './walk.js';

// Hash composition per the decisions ledger: block = (type, value, meta);
// section = (type, title, ordered block hashes); positions, depth, index
// and descendants OUTSIDE the lock.

const SHAPE = /^sha256:[0-9a-f]{64}$/;

describe('blockHash', () => {
  it('is sha256-prefixed and deterministic', () => {
    const h = blockHash('paragraph', 'text', undefined);
    expect(h).toMatch(SHAPE);
    expect(blockHash('paragraph', 'text', undefined)).toBe(h);
  });

  it('is sensitive to type, value and meta', () => {
    const base = blockHash('code', 'x', { lang: 'ts' });
    expect(blockHash('diagram', 'x', { lang: 'ts' })).not.toBe(base);
    expect(blockHash('code', 'y', { lang: 'ts' })).not.toBe(base);
    expect(blockHash('code', 'x', { lang: 'js' })).not.toBe(base);
  });

  it('canonicalises meta: key order and undefined values', () => {
    const a = blockHash('code', 'x', { lang: 'ts', callout: 'note' });
    const b = blockHash('code', 'x', { callout: 'note', lang: 'ts' });
    expect(b).toBe(a);
    expect(blockHash('code', 'x', { lang: 'ts', callout: undefined }))
      .toBe(blockHash('code', 'x', { lang: 'ts' }));
  });

  it('treats absent and empty meta as the same lock', () => {
    expect(blockHash('paragraph', 'x', {}))
      .toBe(blockHash('paragraph', 'x', undefined));
    expect(blockHash('paragraph', 'x', { lang: undefined }))
      .toBe(blockHash('paragraph', 'x', undefined));
  });
});

describe('sectionHash', () => {
  it('is sensitive to type, title and ordered block hashes', () => {
    const h1 = blockHash('paragraph', 'a', undefined);
    const h2 = blockHash('paragraph', 'b', undefined);
    const base = sectionHash('section', 'T', [h1, h2]);
    expect(base).toMatch(SHAPE);
    expect(sectionHash('front-matter', 'T', [h1, h2])).not.toBe(base);
    expect(sectionHash('section', 'Other', [h1, h2])).not.toBe(base);
    expect(sectionHash('section', 'T', [h2, h1])).not.toBe(base);
    expect(sectionHash('section', 'T', [h1])).not.toBe(base);
  });

  it('distinguishes a missing title from an empty one', () => {
    expect(sectionHash('section', undefined, []))
      .not.toBe(sectionHash('section', '', []));
  });
});

describe('hash composition through the fold', () => {
  it('excludes descendants: a child edit leaves the parent hash alone', () => {
    const a1 = parseMarkdown('# A\n\nbody\n\n## B\n\nchild one\n');
    const a2 = parseMarkdown('# A\n\nbody\n\n## B\n\nchild EDITED\n');
    const a3 = parseMarkdown('# A\n\nbody\n');
    const get = (root: typeof a1, t: string) =>
      findSection(root, (s) => s.title === t)!;
    expect(get(a2, 'A').hash).toBe(get(a1, 'A').hash);
    expect(get(a3, 'A').hash).toBe(get(a1, 'A').hash); // child removed
    expect(get(a2, 'B').hash).not.toBe(get(a1, 'B').hash);
  });

  it('excludes position, depth and index: a moved section hashes equal', () => {
    const before = parseMarkdown('# X\n\nstable body\n\n# Y\n\nother\n');
    const after = parseMarkdown(
      '# New\n\npadding to shift bytes\n\n# Y\n\nother\n\n## X\n\n'
      + 'stable body\n',
    );
    const x1 = findSection(before, (s) => s.title === 'X')!;
    const x2 = findSection(after, (s) => s.title === 'X')!;
    expect(x2.depth).not.toBe(x1.depth);
    expect(x2.position).not.toEqual(x1.position);
    expect(x2.hash).toBe(x1.hash);
  });

  it('excludes block position: same content at shifted offsets', () => {
    const b1 = parseMarkdown('prefix\n\nstable paragraph\n');
    const b2 = parseMarkdown('a much longer prefix here\n\n'
      + 'stable paragraph\n');
    expect(b1.content![1]!.hash).toBe(b2.content![1]!.hash);
    expect(b1.content![1]!.position).not.toEqual(b2.content![1]!.position);
  });

  it('locks block order into the section hash', () => {
    const s1 = parseMarkdown('# A\n\none\n\ntwo\n');
    const s2 = parseMarkdown('# A\n\ntwo\n\none\n');
    expect(s1.children![0]!.hash).not.toBe(s2.children![0]!.hash);
  });

  it('keeps later siblings lock-stable through a sibling insert', () => {
    // The §2.5 resolution: index is outside the lock precisely so an
    // insert does not poison every following sibling's hash.
    const before = parseMarkdown('# A\n\na\n\n# B\n\nb\n\n# C\n\nc\n');
    const after = parseMarkdown(
      '# A\n\na\n\n# NEW\n\nn\n\n# B\n\nb\n\n# C\n\nc\n',
    );
    const get = (root: typeof before, t: string) =>
      findSection(root, (s) => s.title === t)!;
    expect(get(after, 'B').index).not.toBe(get(before, 'B').index);
    expect(get(after, 'B').hash).toBe(get(before, 'B').hash);
    expect(get(after, 'C').hash).toBe(get(before, 'C').hash);
  });
});
