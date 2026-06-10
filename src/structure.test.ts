import { describe, it, expect } from 'vitest';
import { extractSection, formatOutline } from './structure.js';
import type { Section } from './types.js';

const md = [
  '# Title', 'Intro.', '',
  '## Install', 'Run it.', '',
  '## Usage', 'Use it.',
].join('\n');

const sections: Section[] = [
  { level: 1, title: 'Title', slug: 'title', startLine: 1, endLine: 3 },
  { level: 2, title: 'Install', slug: 'install', startLine: 4, endLine: 6 },
  { level: 2, title: 'Usage', slug: 'usage', startLine: 7, endLine: 8 },
];

describe('extractSection', () => {
  it('slices by slug', () => {
    expect(extractSection(md, sections, 'install')).toContain('Run it.');
    expect(extractSection(md, sections, 'install')).not.toContain('Use it.');
  });
  it('slices by case-insensitive title', () => {
    expect(extractSection(md, sections, 'USAGE')).toContain('Use it.');
  });
  it('returns null for unknown', () => {
    expect(extractSection(md, sections, 'nope')).toBeNull();
  });
});

describe('formatOutline', () => {
  it('indents by level and shows slugs', () => {
    const out = formatOutline(sections);
    expect(out).toContain('- Title [title]');
    expect(out).toContain('  - Install [install]');
  });
  it('handles empty', () => {
    expect(formatOutline([])).toBe('(no headings)');
  });
});
