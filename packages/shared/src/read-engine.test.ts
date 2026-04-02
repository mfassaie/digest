import { describe, it, expect } from 'vitest';
import { extractiveEngine } from './read-engine.js';

const md = `# Caching

The cache stores fetched documents on disk. Each document is keyed by a
hash of its URL. The cache validates entries with conditional requests.

## Eviction

Old entries are removed when the cache grows beyond its size limit. The
eviction policy is least-recently-used. Eviction keeps the cache bounded.

\`\`\`js
// code should be ignored by the summariser
const x = 1;
\`\`\`
`;

describe('extractiveEngine.summarise', () => {
  it('returns at most maxSentences sentences', () => {
    const out = extractiveEngine.summarise(md, 2);
    const count = out.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    expect(count).toBeLessThanOrEqual(2);
    expect(out.length).toBeGreaterThan(0);
  });
  it('ignores fenced code content', () => {
    expect(extractiveEngine.summarise(md, 3)).not.toContain('const x');
  });
});

describe('extractiveEngine.keywords', () => {
  it('surfaces salient content terms, not stopwords', () => {
    const kw = extractiveEngine.keywords(md, 5);
    expect(kw).toContain('cache');
    expect(kw).not.toContain('the');
    expect(kw.length).toBeLessThanOrEqual(5);
  });
  it('excludes code identifiers', () => {
    expect(extractiveEngine.keywords(md, 20)).not.toContain('const');
  });
});
