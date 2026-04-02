import { describe, it, expect } from 'vitest';
import { buildStructure, extractSection } from './structure.js';

const md = [
  '# Title',
  'Intro paragraph.',
  '',
  '## Install',
  'Run the installer.',
  '',
  '## Usage',
  'Use it like so.',
  '',
  '### Advanced',
  'Deep details.',
  '',
  '## Title', // duplicate title -> slug dedupe
  'Second.',
].join('\n');

describe('buildStructure', () => {
  it('extracts headings with levels, slugs and line ranges', () => {
    const s = buildStructure(md);
    expect(s.map((x) => x.title)).toEqual([
      'Title', 'Install', 'Usage', 'Advanced', 'Title',
    ]);
    expect(s.map((x) => x.level)).toEqual([1, 2, 2, 3, 2]);
  });

  it('dedupes slugs', () => {
    const s = buildStructure(md);
    expect(s[0].slug).toBe('title');
    expect(s[4].slug).toBe('title-1');
  });

  it('section spans until next heading of equal-or-higher level', () => {
    const s = buildStructure(md);
    const usage = s.find((x) => x.title === 'Usage')!;
    // Usage (line 7) should include its ### Advanced subsection,
    // ending before the next ## (line 13).
    expect(usage.startLine).toBe(7);
    expect(usage.endLine).toBe(12);
  });

  it('ignores headings inside fenced code blocks', () => {
    const fenced = [
      '# Real',
      '```bash',
      '# not a heading',
      'echo hi',
      '```',
      '## Also real',
    ].join('\n');
    const s = buildStructure(fenced);
    expect(s.map((x) => x.title)).toEqual(['Real', 'Also real']);
  });
});

describe('extractSection', () => {
  it('returns section content by slug', () => {
    const s = buildStructure(md);
    const out = extractSection(md, s, 'install');
    expect(out).toContain('## Install');
    expect(out).toContain('Run the installer.');
    expect(out).not.toContain('Use it like so.');
  });

  it('returns section content by case-insensitive title', () => {
    const s = buildStructure(md);
    expect(extractSection(md, s, 'USAGE')).toContain('Use it like so.');
  });

  it('includes nested subsections', () => {
    const s = buildStructure(md);
    const out = extractSection(md, s, 'usage')!;
    expect(out).toContain('### Advanced');
    expect(out).toContain('Deep details.');
  });

  it('returns null for unknown section', () => {
    const s = buildStructure(md);
    expect(extractSection(md, s, 'nope')).toBeNull();
  });
});
