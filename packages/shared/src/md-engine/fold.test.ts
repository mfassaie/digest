import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './fold.js';
import type { BytePosition, DocumentSection } from './types.js';
import { allBlocks, allSections, findSection } from './walk.js';

const ID_SHAPE = /^[A-Za-z0-9_-]{22}$/;

function byteSlice(markdown: string, position: BytePosition): string {
  return Buffer.from(markdown, 'utf8')
    .subarray(position.start, position.end)
    .toString('utf8');
}

// The trap fixture: every construct a naive heading scan corrupts, plus
// the GFM and frontmatter vocabulary (plan M3 acceptance).
const TRAPS = `---
title: Traps
n: 1
---

Preamble prose, pre-heading.

[ref]: https://example.com

# Top

\`\`\`md
# not a heading
\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`

\`\`\`
no lang fence
\`\`\`

Setext
======

Sub
---

<div>
# not a heading either
</div>

| a | b |
| - | - |
| 1 | 2 |

- [ ] one
- [x] two

> quoted text

***

![logo](logo.png)

![byref][ref]

Uses a footnote[^n].

[^n]: footnote body
`;

describe('fold: section structure', () => {
  const root = parseMarkdown(TRAPS);

  it('builds root / front-matter / sections with depth and index', () => {
    expect(root.type).toBe('root');
    expect(root.depth).toBe(0);
    expect(root.index).toBe(0);
    const kids = root.children ?? [];
    expect(kids.map((s) => [s.type, s.title, s.depth, s.index])).toEqual([
      ['front-matter', undefined, 1, 0],
      ['section', 'Top', 1, 1],
      ['section', 'Setext', 1, 2],
    ]);
    const setext = kids[2]!;
    expect((setext.children ?? []).map((s) => [s.type, s.title, s.depth]))
      .toEqual([['section', 'Sub', 2]]);
  });

  it('never mints sections from fences, html blocks or table pipes', () => {
    const titles = allSections(root).map((s) => s.title);
    expect(titles).not.toContain('not a heading');
    expect(titles).not.toContain('not a heading either');
    expect(allSections(root)).toHaveLength(5); // root, fm, Top, Setext, Sub
  });

  it('keeps pre-heading blocks in root.content', () => {
    const values = (root.content ?? []).map((b) => b.value);
    expect(values[0]).toBe('Preamble prose, pre-heading.');
    expect(values).toContain('[ref]: https://example.com');
  });

  it('mints 22-char base64url ids on every node', () => {
    for (const s of allSections(root)) expect(s.id).toMatch(ID_SHAPE);
    for (const b of allBlocks(root)) expect(b.id).toMatch(ID_SHAPE);
    const ids = [
      ...allSections(root).map((s) => s.id),
      ...allBlocks(root).map((b) => b.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fold: block typing (§5.3 vocabulary)', () => {
  const root = parseMarkdown(TRAPS);

  it('types the trap fixture blocks', () => {
    const top = findSection(root, (s) => s.title === 'Top')!;
    expect((top.content ?? []).map((b) => b.type))
      .toEqual(['code', 'diagram', 'code']);
    expect(top.content![0]!.meta).toEqual({ lang: 'md' });
    expect(top.content![1]!.meta).toEqual({ lang: 'mermaid' });
    expect(top.content![2]!.meta).toBeUndefined();

    const sub = findSection(root, (s) => s.title === 'Sub')!;
    expect((sub.content ?? []).map((b) => b.type)).toEqual([
      'html', 'table', 'list', 'quote', 'break', 'image', 'image',
      'paragraph', 'footnote',
    ]);
  });

  it('classifies diagram fences case-insensitively, keeping the case', () => {
    const root2 = parseMarkdown('```PlantUML\n@startuml\n```\n\n```dot\nx\n```');
    const types = (root2.content ?? []).map((b) => [b.type, b.meta?.lang]);
    expect(types).toEqual([['diagram', 'PlantUML'], ['diagram', 'dot']]);
  });

  it('keeps image-with-text paragraphs as paragraphs', () => {
    const root2 = parseMarkdown('![alt](x.png) plus trailing words');
    expect(root2.content![0]!.type).toBe('paragraph');
  });

  it('front-matter is one code block carrying the inner YAML', () => {
    const fm = findSection(root, (s) => s.type === 'front-matter')!;
    expect(fm.content).toHaveLength(1);
    const block = fm.content![0]!;
    expect(block.type).toBe('code');
    expect(block.meta).toEqual({ lang: 'yaml' });
    expect(block.value).toBe('title: Traps\nn: 1');
    expect(byteSlice(TRAPS, fm.position)).toBe('---\ntitle: Traps\nn: 1\n---');
  });
});

describe('fold: positions', () => {
  it('block values equal their byte slices (raw, never re-serialised)', () => {
    const root = parseMarkdown(TRAPS);
    const fm = findSection(root, (s) => s.type === 'front-matter')!;
    const fmBlock = fm.content![0]!;
    for (const b of allBlocks(root)) {
      if (b === fmBlock) continue; // value = inner YAML by design (§4)
      expect(byteSlice(TRAPS, b.position)).toBe(b.value);
    }
  });

  it('section start is the heading start; root spans the whole file', () => {
    const root = parseMarkdown(TRAPS);
    expect(root.position).toEqual(
      { start: 0, end: Buffer.byteLength(TRAPS) },
    );
    const top = findSection(root, (s) => s.title === 'Top')!;
    expect(byteSlice(TRAPS, top.position).startsWith('# Top')).toBe(true);
    const setext = findSection(root, (s) => s.title === 'Setext')!;
    expect(byteSlice(TRAPS, setext.position).startsWith('Setext\n======'))
      .toBe(true);
    // a section's end covers its last descendant block
    expect(byteSlice(TRAPS, setext.position).endsWith('[^n]: footnote body'))
      .toBe(true);
  });

  it('positions are UTF-8 byte offsets on non-ASCII documents', () => {
    const md = 'Café ☕ naïve 中文 😀.\n\n# Tête\n\nContenu á.\n';
    const root = parseMarkdown(md);
    for (const b of allBlocks(root)) {
      expect(byteSlice(md, b.position)).toBe(b.value);
    }
    const tete = findSection(root, (s) => s.title === 'Tête')!;
    const headingByteStart = Buffer.byteLength(md.slice(0, md.indexOf('# T')));
    expect(tete.position.start).toBe(headingByteStart);
    expect(byteSlice(md, tete.position)).toBe('# Tête\n\nContenu á.');
  });

  it('holds the value/slice invariant on CRLF documents', () => {
    const md = '# A\r\n\r\nLine one.\r\n\r\n## B\r\n\r\n- item\r\n';
    const root = parseMarkdown(md);
    for (const b of allBlocks(root)) {
      expect(byteSlice(md, b.position)).toBe(b.value);
    }
    expect(allSections(root).map((s) => s.title))
      .toEqual([undefined, 'A', 'B']);
  });
});

describe('fold: heading-depth grouping', () => {
  it('nests skipped levels one tree depth down', () => {
    const root = parseMarkdown('# A\n\n### C\n\n## B\n\n#### D\n');
    const a = root.children![0]!;
    expect(a.title).toBe('A');
    expect(a.children!.map((s) => [s.title, s.depth, s.index])).toEqual([
      ['C', 2, 0],
      ['B', 2, 1],
    ]);
    const b = a.children![1]!;
    expect(b.children!.map((s) => [s.title, s.depth])).toEqual([['D', 3]]);
  });

  it('pops back up for an equal-or-shallower heading', () => {
    const root = parseMarkdown('# A\n\n## A1\n\n## A2\n\n# B\n\nbody\n');
    expect(root.children!.map((s) => s.title)).toEqual(['A', 'B']);
    expect(root.children![0]!.children!.map((s) => s.title))
      .toEqual(['A1', 'A2']);
    expect(root.children![1]!.content![0]!.value).toBe('body');
  });

  it('flattens heading markup into the title', () => {
    const root = parseMarkdown('# Hello `world` **now**\n');
    expect(root.children![0]!.title).toBe('Hello world now');
  });
});

describe('fold: edges', () => {
  it('handles the empty document', () => {
    const root = parseMarkdown('');
    expect(root.type).toBe('root');
    expect(root.children).toBeUndefined();
    expect(root.content).toBeUndefined();
    expect(root.position).toEqual({ start: 0, end: 0 });
    expect(root.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('handles empty front-matter', () => {
    const root = parseMarkdown('---\n---\n');
    const fm = root.children![0]!;
    expect(fm.type).toBe('front-matter');
    expect(fm.content![0]!.value).toBe('');
  });

  it('stamps created_at on every node when now is given', () => {
    const now = '2026-06-13T10:00:00.000Z';
    const root = parseMarkdown(TRAPS, { now });
    for (const s of allSections(root)) expect(s.created_at).toBe(now);
    for (const b of allBlocks(root)) expect(b.created_at).toBe(now);
  });

  it('leaves timestamps off when now is not given', () => {
    const root = parseMarkdown(TRAPS);
    for (const s of allSections(root)) expect(s.created_at).toBeUndefined();
  });

  it('keeps duplicate sibling titles as distinct sections', () => {
    const root = parseMarkdown('# API\n\none\n\n# API\n\ntwo\n');
    const kids = root.children!;
    expect(kids.map((s) => s.title)).toEqual(['API', 'API']);
    expect(kids[0]!.id).not.toBe(kids[1]!.id);
  });
});

describe('fold: hash wiring', () => {
  it('writes sha256-prefixed hashes on all nodes', () => {
    const root = parseMarkdown(TRAPS);
    const shape = /^sha256:[0-9a-f]{64}$/;
    for (const s of allSections(root)) expect(s.hash).toMatch(shape);
    for (const b of allBlocks(root)) expect(b.hash).toMatch(shape);
  });

  it('section content order is blocks before child sections', () => {
    const md = '# A\n\nfirst\n\n## B\n\nsecond\n';
    const root = parseMarkdown(md);
    const a: DocumentSection = root.children![0]!;
    expect(a.content!.map((b) => b.value)).toEqual(['first']);
    expect(a.children!.map((s) => s.title)).toEqual(['B']);
  });
});
