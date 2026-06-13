import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocumentSection } from '@digest/shared';
import type { ServerDeps } from '../deps.js';
import { formatError, jsonText, text, type TextResult } from '../response.js';

// The read_section tool (ADR-011 design §4, §5.4): serve individual
// sections WITH their content blocks from a stored document Digest.
// One module per tool (plan M4); server.ts only registers.

export const READ_SECTION_TOOL = 'read_section';

// 50 KB threshold for a single section's serialised content blocks.
// Exceeding this sets the truncated flag and points at children ids.
const OVERSIZED_THRESHOLD = 50_000;

export const readSectionSchema = {
  artefact_id: z.string().describe(
    '22-char artefact id of a document-type Digest.',
  ),
  section_id: z.union([
    z.string(),
    z.array(z.string()).min(1),
  ]).describe(
    'One section id or an array of section ids to retrieve.',
  ),
  children_mode: z.enum(['include', 'exclude']).optional()
    .default('include')
    .describe(
      "'include' (default) returns children subtrees with content; " +
      "'exclude' returns only the requested sections, no descendants.",
    ),
};

export interface ReadSectionArgs {
  artefact_id: string;
  section_id: string | string[];
  children_mode?: 'include' | 'exclude';
}

interface ProjectedSection {
  id: string;
  type: string;
  depth: number;
  index: number;
  title?: string;
  meta?: Record<string, unknown>;
  hash: string;
  created_at: string;
  updated_at?: string;
  content?: unknown[];
  children?: ProjectedSection[];
  truncated?: boolean;
  child_ids?: string[];
}

// Walk the section tree, collecting all section ids.
function collectIds(section: DocumentSection): string[] {
  const ids = [section.id];
  for (const child of section.children ?? []) {
    ids.push(...collectIds(child));
  }
  return ids;
}

// Find a section by id in the tree.
function findById(
  root: DocumentSection, id: string,
): DocumentSection | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

// Project a section with content blocks attached. When children_mode
// is 'include', children carry their content recursively. When
// 'exclude', children are omitted entirely.
function projectSection(
  section: DocumentSection, childrenMode: 'include' | 'exclude',
): ProjectedSection {
  const result: ProjectedSection = {
    id: section.id,
    type: section.type,
    depth: section.depth,
    index: section.index,
    hash: section.hash,
    created_at: section.created_at,
  };
  if (section.title !== undefined) result.title = section.title;
  if (section.meta !== undefined) {
    result.meta = section.meta as Record<string, unknown>;
  }
  if (section.updated_at !== undefined) {
    result.updated_at = section.updated_at;
  }
  if (section.content !== undefined && section.content.length > 0) {
    result.content = section.content;
  }
  if (childrenMode === 'include' && section.children !== undefined
    && section.children.length > 0) {
    result.children = section.children.map(
      (c) => projectSection(c, 'include'),
    );
  }
  return result;
}

// Check whether a single section's content blocks serialise above the
// oversized threshold. If so, set the truncated flag, strip content,
// and list child ids as the next step for the caller.
function applyOversizeGuard(section: ProjectedSection): ProjectedSection {
  const contentJson = JSON.stringify(section.content ?? []);
  if (contentJson.length <= OVERSIZED_THRESHOLD) return section;
  const childIds = (section.children ?? []).map((c) => c.id);
  return {
    ...section,
    content: undefined,
    children: undefined,
    truncated: true,
    ...(childIds.length > 0 ? { child_ids: childIds } : {}),
  };
}

export async function handleReadSection(
  args: ReadSectionArgs, deps: ServerDeps,
): Promise<TextResult> {
  const digest = await deps.store.readDigest(args.artefact_id);
  if (digest === null) {
    return text(formatError(
      args.artefact_id, 'unknown artefact id',
    ), true);
  }
  if (digest.type !== 'document' || digest.document === undefined) {
    return text(formatError(
      args.artefact_id,
      'not a document artefact — read_section requires a document Digest.',
    ), true);
  }

  const requestedIds = Array.isArray(args.section_id)
    ? args.section_id : [args.section_id];
  const childrenMode = args.children_mode ?? 'include';
  const root = digest.document.sections;

  // Validate all requested ids exist before returning any content.
  const validIds = collectIds(root);
  const unknownIds = requestedIds.filter((id) => !validIds.includes(id));
  if (unknownIds.length > 0) {
    return text(formatError(
      args.artefact_id,
      `unknown section id(s): ${unknownIds.join(', ')}. ` +
      `Valid ids in this artefact: ${validIds.join(', ')}`,
    ), true);
  }

  const sections: ProjectedSection[] = [];
  for (const id of requestedIds) {
    const section = findById(root, id)!;
    let projected = projectSection(section, childrenMode);
    // Oversize guard only applies to single-section requests (design
    // §7: "oversized single sections flag truncated").
    if (requestedIds.length === 1) {
      projected = applyOversizeGuard(projected);
    }
    sections.push(projected);
  }

  return jsonText({
    artefact_id: args.artefact_id,
    children_mode: childrenMode,
    sections,
  });
}

export function registerReadSectionTool(
  server: McpServer, deps: ServerDeps,
): void {
  server.tool(
    READ_SECTION_TOOL,
    'Read one or more sections by id from a document Digest, with ' +
    'content blocks attached. Use read_document first for the toc.',
    readSectionSchema,
    (args) => handleReadSection(args as ReadSectionArgs, deps),
  );
}
