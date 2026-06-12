import { describe, expect, it } from 'vitest';

import { computeExtracts } from './extracts.js';
import { parseMarkdown } from './fold.js';
import type { ReadEngine } from '../read-engine.js';

const DOC = `---
title: Zebra Manual
zzzfrontkey: zzzfrontval
---

Falcons hunt at speed. Falcons dive steeply when hunting prey together.

# Habits

Falcons nest on cliffs and falcons return yearly to the same cliffs.

\`\`\`ts
const zzzcodeword = 1;
\`\`\`

## Diet

Falcons eat smaller birds and falcons rarely eat carrion at all.
`;

describe('computeExtracts', () => {
  it('summarises and extracts keywords from block values', () => {
    const { summary, keywords } = computeExtracts(parseMarkdown(DOC));
    expect(summary.length).toBeGreaterThan(20);
    expect(summary.toLowerCase()).toContain('falcons');
    expect(keywords).toContain('falcons');
    expect(keywords.length).toBeLessThanOrEqual(12);
  });

  it('skips front-matter values and fenced code internals', () => {
    const { keywords, summary } = computeExtracts(parseMarkdown(DOC));
    expect(keywords).not.toContain('zzzfrontkey');
    expect(keywords).not.toContain('zzzfrontval');
    expect(keywords).not.toContain('zzzcodeword'); // read-engine strips fences
    expect(summary).not.toContain('zzzfrontval');
  });

  it('feeds the engine concatenated block values in document order', () => {
    const seen: string[] = [];
    const fake: ReadEngine = {
      summarise(text, max) {
        seen.push(text);
        return `s${max}`;
      },
      keywords(text, max) {
        seen.push(text);
        return [`k${max}`];
      },
    };
    const out = computeExtracts(parseMarkdown(DOC), {
      engine: fake, summarySentences: 2, keywordCount: 3,
    });
    expect(out).toEqual({ summary: 's2', keywords: ['k3'] });
    const [text] = seen;
    expect(seen[1]).toBe(text);
    const order = [
      text!.indexOf('Falcons hunt'), // root preamble first
      text!.indexOf('nest on cliffs'),
      text!.indexOf('const zzzcodeword'), // raw value reaches the engine
      text!.indexOf('eat smaller birds'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('zzzfrontkey');
  });

  it('handles a document with no prose', () => {
    const out = computeExtracts(parseMarkdown('# Only A Heading\n'));
    expect(out.summary).toBe('');
    expect(out.keywords).toEqual([]);
  });
});
