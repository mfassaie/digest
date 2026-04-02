import { describe, it, expect } from 'vitest';
import { serialiseSection } from './serialise.js';

describe('serialiseSection', () => {
  it('emits heading at the correct depth for a section', () => {
    const md = serialiseSection({
      type: 'section', depth: 2, title: 'Install',
      content: [{ type: 'paragraph', value: 'Run npm install.' }],
    });
    expect(md).toBe('## Install\n\nRun npm install.');
  });

  it('handles nested children at increasing depths', () => {
    const md = serialiseSection({
      type: 'section', depth: 1, title: 'Usage',
      content: [{ type: 'paragraph', value: 'Use it.' }],
      children: [{
        type: 'section', depth: 2, title: 'Advanced',
        content: [{ type: 'paragraph', value: 'Power mode.' }],
      }],
    });
    expect(md).toBe(
      '# Usage\n\nUse it.\n\n## Advanced\n\nPower mode.',
    );
  });

  it('serialises front-matter with YAML fences', () => {
    const md = serialiseSection({
      type: 'front-matter', depth: 1,
      content: [{
        type: 'code', value: 'title: Hello\nauthor: Test',
        meta: { lang: 'yaml' },
      }],
    });
    expect(md).toBe('---\ntitle: Hello\nauthor: Test\n---');
  });

  it('emits content blocks verbatim in order', () => {
    const md = serialiseSection({
      type: 'section', depth: 3, title: 'Multi',
      content: [
        { type: 'paragraph', value: 'First paragraph.' },
        { type: 'code', value: '```js\nconsole.log("hi");\n```' },
        { type: 'paragraph', value: 'Last paragraph.' },
      ],
    });
    expect(md).toContain('### Multi');
    expect(md).toContain('First paragraph.');
    expect(md).toContain('```js\nconsole.log("hi");\n```');
    expect(md).toContain('Last paragraph.');
  });

  it('omits heading for root type', () => {
    const md = serialiseSection({
      type: 'root', depth: 0,
      content: [{ type: 'paragraph', value: 'Preamble.' }],
    });
    expect(md).toBe('Preamble.');
    expect(md).not.toContain('#');
  });

  it('handles a section with no content or children', () => {
    const md = serialiseSection({
      type: 'section', depth: 1, title: 'Empty',
    });
    expect(md).toBe('# Empty');
  });

  it('handles front-matter with no content blocks', () => {
    const md = serialiseSection({
      type: 'front-matter', depth: 1,
    });
    expect(md).toBe('');
  });
});
