export interface Section {
  level: number;
  title: string;
  slug: string;
  // 1-based inclusive line range into content.md. startLine is the heading
  // line; endLine is the last line before the next heading of equal-or-
  // higher level (or end of document).
  startLine: number;
  endLine: number;
}

function slugify(text: string, used: Set<string>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
  let slug = base;
  let n = 1;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

interface RawHeading {
  level: number;
  title: string;
  line: number; // 1-based
}

// Parse ATX headings, ignoring those inside fenced code blocks.
function parseHeadings(markdown: string): RawHeading[] {
  const lines = markdown.split('\n');
  const heads: RawHeading[] = [];
  let inFence = false;
  let marker = '';
  lines.forEach((line, idx) => {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) { inFence = true; marker = fence[1][0]; }
      else if (fence[1][0] === marker) { inFence = false; }
      return;
    }
    if (inFence) return;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: idx + 1 });
  });
  return heads;
}

// Build the section outline with line ranges. A section runs from its
// heading to the line before the next heading of equal-or-higher level.
export function buildStructure(markdown: string): Section[] {
  const totalLines = markdown.split('\n').length;
  const heads = parseHeadings(markdown);
  const used = new Set<string>();
  return heads.map((h, i) => {
    let end = totalLines;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { end = heads[j].line - 1; break; }
    }
    return {
      level: h.level,
      title: h.title,
      slug: slugify(h.title, used),
      startLine: h.line,
      endLine: end,
    };
  });
}

// Slice a named section's content out of the markdown by slug or (case-
// insensitive) title. Returns null when no section matches.
export function extractSection(
  markdown: string, sections: Section[], ref: string,
): string | null {
  const needle = ref.toLowerCase().trim();
  const match = sections.find(
    (s) => s.slug === needle || s.title.toLowerCase().trim() === needle,
  );
  if (!match) return null;
  const lines = markdown.split('\n');
  return lines.slice(match.startLine - 1, match.endLine).join('\n').trim();
}
