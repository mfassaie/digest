import type { Section } from './types.js';

// Slice a named section out of content.md by slug or case-insensitive title,
// using the line ranges the container recorded in structure.json.
export function extractSection(
  markdown: string, sections: Section[], ref: string,
): string | null {
  const needle = ref.toLowerCase().trim();
  const match = sections.find(
    (s) => s.slug === needle || s.title.toLowerCase().trim() === needle,
  );
  if (!match) return null;
  return markdown
    .split('\n')
    .slice(match.startLine - 1, match.endLine)
    .join('\n')
    .trim();
}

// Indented heading outline for the get response and the sections read mode.
export function formatOutline(sections: Section[]): string {
  if (sections.length === 0) return '(no headings)';
  return sections
    .map((s) => `${'  '.repeat(Math.max(0, s.level - 1))}- ${s.title} `
      + `[${s.slug}]`)
    .join('\n');
}
