import { describe, it, expect } from 'vitest';
import { formatGet, formatError, formatRedirect } from './response.js';
import type { CacheMeta, Section } from '@digest/shared';

const sections: Section[] = [
  { level: 1, title: 'Title', slug: 'title', startLine: 1, endLine: 3 },
];

function meta(over: Partial<CacheMeta> = {}): CacheMeta {
  return {
    cacheVersion: 2,
    url: 'https://ex.com/p',
    finalUrl: 'https://ex.com/p',
    contentType: 'text/html',
    category: 'html',
    converter: 'defuddle',
    fetchedAt: '2026-06-13T00:00:00.000Z',
    rawFile: 'raw.html',
    ...over,
  };
}

describe('formatGet', () => {
  it('renders full metadata including author, published and final URL', () => {
    const out = formatGet({
      meta: meta({
        finalUrl: 'https://ex.com/final',
        title: 'T', author: 'A', published: '2026-01-01',
        description: 'D', wordCount: 42,
        markdownFile: 'content.md', structureFile: 'structure.json',
      }),
      dir: '/tmp/cache',
      sections,
      rawSize: 2048,
      markdownSize: 1536,
      source: 'fresh',
    });
    expect(out).toContain('Final URL: https://ex.com/final');
    expect(out).toContain('Title: T');
    expect(out).toContain('Author: A');
    expect(out).toContain('Published: 2026-01-01');
    expect(out).toContain('Description: D');
    expect(out).toContain('Word count: 42');
    expect(out).toContain('markdown: /tmp/cache/content.md');
    expect(out).toContain('1.5 KB (markdown)');
    expect(out).toContain('2.0 KB (raw)');
    expect(out).toContain('Sections (1):');
    expect(out).toContain('Source: fresh');
  });

  it('omits the markdown block for raw-only entries', () => {
    const out = formatGet({
      meta: meta(),
      dir: '/tmp/cache',
      sections: [],
      rawSize: 10,
      source: 'fresh',
    });
    expect(out).not.toContain('markdown:');
    expect(out).not.toContain('Sections (');
    expect(out).toContain('10 B (raw)');
  });

  it('formats megabyte sizes', () => {
    const out = formatGet({
      meta: meta(),
      dir: '/tmp/cache',
      sections: [],
      rawSize: 3 * 1024 * 1024,
      source: 'cache (validated)',
    });
    expect(out).toContain('3.0 MB (raw)');
    expect(out).toContain('Source: cache (validated)');
  });
});

describe('formatError', () => {
  it('includes the url and reason', () => {
    const out = formatError('https://ex.com', 'HTTP 404');
    expect(out).toContain('Error fetching https://ex.com');
    expect(out).toContain('Reason: HTTP 404');
  });
});

describe('formatRedirect', () => {
  it('shows both hosts and the follow-up hint', () => {
    const out = formatRedirect('https://a.com/x', 'https://b.com/y');
    expect(out).toContain('From: https://a.com/x');
    expect(out).toContain('To: https://b.com/y');
    expect(out).toContain('new request');
  });
});
