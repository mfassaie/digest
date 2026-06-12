import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './fold.js';
import { rematchIds } from './rematch.js';
import type { DocumentSection } from './types.js';
import { findSection } from './walk.js';

// Id stickiness (design §2.4: "minted at first parse, sticky forever";
// re-match by exact title within parent, then position; retired ids never
// reused).

const BASE = [
  '---', 'title: Doc', '---', '',
  'Preamble.', '',
  '# One', '', 'Alpha.', '', '```ts', 'x', '```', '',
  '## One A', '', 'Beta.', '',
  '# Two', '', 'Gamma.', '',
].join('\n');

function reparse(prev: DocumentSection, md: string, now?: string) {
  return rematchIds(prev, parseMarkdown(md), now ? { now } : {});
}

function byTitle(root: DocumentSection, title: string): DocumentSection {
  const found = findSection(root, (s) => s.title === title);
  expect(found, `section '${title}'`).toBeDefined();
  return found!;
}

describe('rematch: stickiness', () => {
  it('keeps every id across an unchanged re-parse', () => {
    const prev = parseMarkdown(BASE);
    const next = reparse(prev, BASE);
    const pair = (s: DocumentSection, t: DocumentSection): void => {
      expect(t.id).toBe(s.id);
      expect((t.content ?? []).map((b) => b.id))
        .toEqual((s.content ?? []).map((b) => b.id));
      (s.children ?? []).forEach((c, i) => pair(c, (t.children ?? [])[i]!));
    };
    pair(prev, next);
  });

  it('keeps ids by exact title when a sibling is inserted before', () => {
    const prev = parseMarkdown(BASE);
    const edited = BASE.replace('# One', '# Zero\n\nNew.\n\n# One');
    const next = reparse(prev, edited);
    expect(byTitle(next, 'One').id).toBe(byTitle(prev, 'One').id);
    expect(byTitle(next, 'Two').id).toBe(byTitle(prev, 'Two').id);
    expect(byTitle(next, 'One A').id).toBe(byTitle(prev, 'One A').id);
    const zeroId = byTitle(next, 'Zero').id;
    const prevIds = new Set([
      byTitle(prev, 'One').id, byTitle(prev, 'Two').id,
      byTitle(prev, 'One A').id, prev.id,
    ]);
    expect(prevIds.has(zeroId)).toBe(false);
  });

  it('keeps the id of a section retitled in place (position pass)', () => {
    const prev = parseMarkdown(BASE);
    const next = reparse(prev, BASE.replace('# Two', '# Two Renamed'));
    expect(byTitle(next, 'Two Renamed').id).toBe(byTitle(prev, 'Two').id);
  });

  it('keeps the id of a section moved among siblings (title pass)', () => {
    const md = '# A\n\na\n\n# B\n\nb\n\n# C\n\nc\n';
    const prev = parseMarkdown(md);
    const next = reparse(prev, '# B\n\nb\n\n# A\n\na\n\n# C\n\nc\n');
    for (const t of ['A', 'B', 'C']) {
      expect(byTitle(next, t).id).toBe(byTitle(prev, t).id);
    }
  });

  it('retires the id of a deleted section and never reuses it', () => {
    const prev = parseMarkdown(BASE);
    const deletedId = byTitle(prev, 'Two').id;
    const edited = BASE.replace('# Two\n\nGamma.\n', '# Fresh\n\nDelta.\n');
    // 'Fresh' matches 'Two' by the position pass here (same index, same
    // type) — so delete AND shrink to force true retirement.
    const shrunk = BASE.replace('# Two\n\nGamma.\n', '');
    const afterDelete = reparse(prev, shrunk);
    const grown = reparse(
      afterDelete, shrunk + '\n# Two\n\nBack again.\n',
    );
    // Same title as the retired section, but matching ran against a tree
    // that no longer holds the id: a fresh id is minted.
    expect(byTitle(grown, 'Two').id).not.toBe(deletedId);
    expect(byTitle(reparse(prev, edited), 'Fresh').id).toBe(deletedId);
  });

  it('pairs duplicate titles in document order, never double-assigning', () => {
    const prev = parseMarkdown('# API\n\none\n\n# API\n\ntwo\n');
    const [p1, p2] = prev.children!;
    const next = reparse(
      prev, '# API\n\none\n\n# API\n\ntwo\n\n# API\n\nthree\n',
    );
    const [n1, n2, n3] = next.children!;
    expect(n1!.id).toBe(p1!.id);
    expect(n2!.id).toBe(p2!.id);
    expect(n3!.id).not.toBe(p1!.id);
    expect(n3!.id).not.toBe(p2!.id);
  });

  it('matches the front-matter section by type', () => {
    const prev = parseMarkdown(BASE);
    const next = reparse(prev, BASE.replace('title: Doc', 'title: Other'));
    const prevFm = prev.children![0]!;
    const nextFm = next.children![0]!;
    expect(nextFm.type).toBe('front-matter');
    expect(nextFm.id).toBe(prevFm.id);
    expect(nextFm.content![0]!.id).toBe(prevFm.content![0]!.id);
  });

  it('does not match children of unmatched parents (anchored identity)', () => {
    const prev = parseMarkdown('# A\n\n## C\n\nbody\n');
    // retitled AND moved: pass 1 misses, pass 2 misses (index changed)
    const next = reparse(
      prev, '# New First\n\nx\n\n# Z\n\n## C\n\nbody\n',
    );
    expect(byTitle(next, 'C').id).not.toBe(byTitle(prev, 'C').id);
  });
});

describe('rematch: blocks', () => {
  it('keeps block ids through a sibling block insert (hash pass)', () => {
    const prev = parseMarkdown('# A\n\nfirst\n\nsecond\n\nthird\n');
    const next = reparse(
      prev, '# A\n\nzeroth\n\nfirst\n\nsecond\n\nthird\n',
    );
    const prevBlocks = byTitle(prev, 'A').content!;
    const nextBlocks = byTitle(next, 'A').content!;
    expect(nextBlocks.slice(1).map((b) => b.id))
      .toEqual(prevBlocks.map((b) => b.id));
    expect(prevBlocks.map((b) => b.id)).not.toContain(nextBlocks[0]!.id);
  });

  it('keeps the id of a block edited in place (index+type pass)', () => {
    const prev = parseMarkdown('# A\n\nfirst\n\nsecond\n\nthird\n');
    const next = reparse(
      prev, '# A\n\nfirst\n\nsecond EDITED\n\nthird\n',
    );
    const prevBlocks = byTitle(prev, 'A').content!;
    const nextBlocks = byTitle(next, 'A').content!;
    expect(nextBlocks.map((b) => b.id)).toEqual(prevBlocks.map((b) => b.id));
  });

  it('does not hand one previous block id to two identical blocks', () => {
    const prev = parseMarkdown('# A\n\nsame\n');
    const next = reparse(prev, '# A\n\nsame\n\nsame\n');
    const ids = byTitle(next, 'A').content!.map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(byTitle(prev, 'A').content![0]!.id);
  });
});

describe('rematch: timestamps', () => {
  const t1 = '2026-06-13T10:00:00.000Z';
  const t2 = '2026-06-13T11:00:00.000Z';

  it('carries created_at, stamps updated_at only on changed nodes', () => {
    const prev = parseMarkdown(BASE, { now: t1 });
    const next = reparse(prev, BASE.replace('Gamma.', 'Gamma edited.'), t2);
    const two = byTitle(next, 'Two');
    expect(two.created_at).toBe(t1);
    expect(two.updated_at).toBe(t2); // block hashes feed the section hash
    expect(two.content![0]!.created_at).toBe(t1);
    expect(two.content![0]!.updated_at).toBe(t2);
    const one = byTitle(next, 'One');
    expect(one.created_at).toBe(t1);
    expect(one.updated_at).toBeUndefined();
  });

  it('stamps created_at on a new subtree', () => {
    const prev = parseMarkdown(BASE, { now: t1 });
    const next = reparse(
      prev, BASE + '\n# Three\n\nNew prose.\n\n## Three A\n\nDeeper.\n', t2,
    );
    const three = byTitle(next, 'Three');
    expect(three.created_at).toBe(t2);
    expect(three.content![0]!.created_at).toBe(t2);
    expect(byTitle(next, 'Three A').created_at).toBe(t2);
  });

  it('carries a stamped updated_at through later untouched re-parses', () => {
    const t3 = '2026-06-13T12:00:00.000Z';
    const prev = parseMarkdown(BASE, { now: t1 });
    const edited = BASE.replace('Gamma.', 'Gamma edited.');
    const second = reparse(prev, edited, t2);
    const third = reparse(second, edited, t3); // no change this time
    const two = byTitle(third, 'Two');
    expect(two.created_at).toBe(t1);
    expect(two.updated_at).toBe(t2);
  });

  it('touches no timestamps when now is omitted', () => {
    const prev = parseMarkdown(BASE); // no timestamps anywhere
    const next = reparse(prev, BASE.replace('Gamma.', 'Changed.'));
    const two = byTitle(next, 'Two');
    expect(two.created_at).toBeUndefined();
    expect(two.updated_at).toBeUndefined();
  });
});
