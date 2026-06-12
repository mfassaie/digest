import type { ContentBlock, DocumentSection } from './types.js';

// Tree traversal helpers over the folded model: document order
// (a section's own blocks precede its child sections).

export function allSections(root: DocumentSection): DocumentSection[] {
  const out: DocumentSection[] = [];
  const walk = (s: DocumentSection): void => {
    out.push(s);
    for (const c of s.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

export function allBlocks(root: DocumentSection): ContentBlock[] {
  return allSections(root).flatMap((s) => s.content ?? []);
}

export function findSection(
  root: DocumentSection, predicate: (s: DocumentSection) => boolean,
): DocumentSection | undefined {
  return allSections(root).find(predicate);
}

export function sectionById(
  root: DocumentSection, id: string,
): DocumentSection | undefined {
  return findSection(root, (s) => s.id === id);
}
