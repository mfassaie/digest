import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { parseMarkdown } from './fold.js';
import { allBlocks, allSections } from './walk.js';

// M3 SPIKE assertions, kept as loud permanent tests (plan M3, design
// §5.6). These encode the assumptions the engine is BUILT on; if one
// fails, revisit the dependency choice — do not patch around it.
// Verified against the pinned deps on 13-06-2026:
//   remark-parse 11.0.0, remark-gfm 4.0.1, remark-frontmatter 5.0.0,
//   unified 11.0.5, yaml 2.9.0.

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .freeze();

const RICH_DOC = `---
title: Spike
tags: [a, b]
---

Intro paragraph with **bold**, \`code\`, ~~gone~~ and a [link](https://x.y).

# One

\`\`\`ts
# not a heading
\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`

| h1 | h2 |
|----|----|
| a  | b  |

- [ ] task one
- [x] task two

> quote

Setext
======

<div>
# not a heading either
</div>

![alt](https://example.com/i.png)

***

Footnote ref[^1].

[^1]: the footnote body
`;

interface AnyNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: AnyNode[];
}

describe('M3 spike: positions', () => {
  it('every mdast node (incl. inline) carries start/end offsets', () => {
    const tree = processor.parse(RICH_DOC) as unknown as AnyNode;
    let count = 0;
    const walk = (node: AnyNode): void => {
      count++;
      expect(node.position?.start.offset, `${node.type} start offset`)
        .toBeTypeOf('number');
      expect(node.position?.end.offset, `${node.type} end offset`)
        .toBeTypeOf('number');
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
    expect(count).toBeGreaterThan(40); // inline nodes included
  });
});

describe('M3 spike: frontmatter fidelity', () => {
  it('yaml node value is the inner YAML, position spans the fences', () => {
    const tree = processor.parse(RICH_DOC) as unknown as AnyNode;
    const yaml = tree.children![0]! as AnyNode & { value: string };
    expect(yaml.type).toBe('yaml');
    expect(yaml.value).toBe('title: Spike\ntags: [a, b]');
    const slice = RICH_DOC.slice(
      yaml.position!.start.offset!, yaml.position!.end.offset!,
    );
    expect(slice).toBe('---\ntitle: Spike\ntags: [a, b]\n---');
  });

  it('YAML parse -> stringify -> parse round-trips the data', () => {
    const data: unknown = parseYaml('title: Spike\ntags: [a, b]');
    expect(data).toEqual({ title: 'Spike', tags: ['a', 'b'] });
    expect(parseYaml(stringifyYaml(data))).toEqual(data);
  });
});

describe('M3 spike: fold cost', () => {
  it('parses + folds a ~1 MiB realistic document within budget', () => {
    // No large REAL markdown document is checked into the repo (the
    // tooling-evals goldens are ~1 KiB), so the spike doc is generated
    // from real dev-doc shapes: heading pairs, prose, fenced code with
    // '#' traps, GFM tables and task lists, quotes.
    const chapters = 4600;
    let big = '---\ntitle: Big\n---\n\n';
    for (let i = 0; i < chapters; i++) {
      big += `# Chapter ${i}\n\n`
        + `Prose for chapter ${i}. `.repeat(3) + '\n\n'
        + `## Detail ${i}\n\n`
        + '```ts\n# trap\nconst x = ' + String(i) + ';\n```\n\n'
        + `| col | val |\n|----|----|\n| k${i} | v${i} |\n\n`
        + `- [ ] item a${i}\n- [x] item b${i}\n\n`
        + `> quote ${i}\n\n`;
    }
    expect(Buffer.byteLength(big)).toBeGreaterThan(1_000_000);

    const t0 = performance.now();
    const root = parseMarkdown(big);
    const elapsed = performance.now() - t0;

    // Exact structural counts prove the fold visited everything.
    expect(allSections(root)).toHaveLength(1 + 1 + chapters * 2);
    expect(allBlocks(root)).toHaveLength(1 + chapters * 5);
    expect(
      elapsed,
      `fold of ${(Buffer.byteLength(big) / 1024).toFixed(0)} KiB took `
      + `${elapsed.toFixed(0)} ms (typical ~2 s; budget 15 s)`,
    ).toBeLessThan(15_000);
  }, 30_000);
});
