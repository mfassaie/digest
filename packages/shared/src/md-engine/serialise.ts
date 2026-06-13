// Section serialiser (plan M6): given a client-supplied section subtree,
// produce the markdown string for splicing into the master md. Titles
// become heading lines at the correct depth; content block values are
// written verbatim (the client's text, never re-rendered). Front-matter
// sections get YAML fence delimiters (---). The result replaces the byte
// range of the existing section.

export interface SerialiseSection {
  type: string;
  depth: number;
  title?: string;
  content?: SerialiseBlock[];
  children?: SerialiseSection[];
}

export interface SerialiseBlock {
  type: string;
  value: string;
  meta?: { lang?: string };
}

// Serialise a section subtree to markdown. The section's own heading is
// NOT emitted for the root or front-matter types (root has no heading;
// front-matter uses YAML fences). For regular sections the heading line
// is emitted at the section's depth as a markdown heading level.
export function serialiseSection(section: SerialiseSection): string {
  const parts: string[] = [];

  if (section.type === 'front-matter') {
    serialiseFrontMatter(section, parts);
  } else {
    if (section.type === 'section' && section.title !== undefined) {
      const hashes = '#'.repeat(section.depth);
      parts.push(`${hashes} ${section.title}`);
    }
    for (const block of section.content ?? []) {
      parts.push(block.value);
    }
  }

  for (const child of section.children ?? []) {
    parts.push(serialiseSection(child));
  }

  return parts.join('\n\n');
}

function serialiseFrontMatter(
  section: SerialiseSection, parts: string[],
): void {
  const block = section.content?.[0];
  if (block === undefined) return;
  // The stored value is the inner YAML (without fences). Re-fence it.
  parts.push(`---\n${block.value}\n---`);
}
