import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './fold.js';
import { allBlocks, allSections, findSection, sectionById } from './walk.js';

const DOC = '# A\n\nfirst\n\n## B\n\nsecond\n\n# C\n\nthird\n';

describe('walk', () => {
  const root = parseMarkdown(DOC);

  it('lists sections in document order, root first', () => {
    expect(allSections(root).map((s) => s.title))
      .toEqual([undefined, 'A', 'B', 'C']);
  });

  it('lists blocks in document order', () => {
    expect(allBlocks(root).map((b) => b.value))
      .toEqual(['first', 'second', 'third']);
  });

  it('finds sections by predicate and by id', () => {
    const b = findSection(root, (s) => s.title === 'B')!;
    expect(b.depth).toBe(2);
    expect(sectionById(root, b.id)).toBe(b);
    expect(sectionById(root, 'nope-nope-nope-nope-no')).toBeUndefined();
    expect(findSection(root, (s) => s.title === 'Z')).toBeUndefined();
  });
});
