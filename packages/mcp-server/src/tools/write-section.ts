import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  writeSection, WriteSectionError,
  type WriteSectionInput,
} from '@digest/shared';
import type { ServerDeps } from '../deps.js';
import { formatError, jsonText, text, type TextResult } from '../response.js';

// The write_section tool (ADR-011 design §4, §3.4): replace a section
// subtree in a document Digest's master markdown with hash-based
// optimistic locking. One module per tool (plan M4 rule); server.ts
// only registers.

export const WRITE_SECTION_TOOL = 'write_section';

const WriteSectionBlockSchema = z.object({
  type: z.string().describe('Block type (paragraph, code, table, etc.)'),
  value: z.string().describe('Raw markdown content of the block.'),
  meta: z.record(z.string(), z.unknown()).optional().describe(
    'Block metadata (e.g. { lang: "js" } for code blocks).',
  ),
});

// Recursive section input schema. The root id must exist in the document;
// descendants with known ids carry their hash for lock validation.
const WriteSectionInputSchema: z.ZodType<WriteSectionInput> = z.object({
  id: z.string().describe(
    '22-char section id. Must exist for the root node; children with ' +
    'known ids = update, unknown ids = new node.',
  ),
  type: z.string().optional().describe(
    'Section type override (root, front-matter, section).',
  ),
  title: z.string().optional().describe(
    'Heading text. Becomes a markdown heading at the correct depth.',
  ),
  hash: z.string().optional().describe(
    'The hash the client read. Required for known sections; mismatch ' +
    'rejects the entire write.',
  ),
  content: z.array(WriteSectionBlockSchema).optional().describe(
    'Replacement content blocks. Written verbatim.',
  ),
  children: z.lazy(() => z.array(WriteSectionInputSchema)).optional()
    .describe(
      "Replacement children. In 'replace' mode, children absent from " +
      'this list are deleted with their subtrees.',
    ),
});

export const writeSectionSchema = {
  artefact_id: z.string().describe(
    '22-char artefact id of a document-type Digest.',
  ),
  section: WriteSectionInputSchema.describe(
    'The section subtree to write. The root id must exist in the document.',
  ),
  children_mode: z.enum(['replace']).optional()
    .default('replace')
    .describe(
      "'replace' (only mode in v1): children absent from the input " +
      'are deleted with their entire subtrees.',
    ),
};

export interface WriteSectionArgs {
  artefact_id: string;
  section: WriteSectionInput;
  children_mode?: 'replace';
}

export async function handleWriteSection(
  args: WriteSectionArgs, deps: ServerDeps,
): Promise<TextResult> {
  try {
    const result = await writeSection(
      args.artefact_id,
      args.section,
      args.children_mode ?? 'replace',
      { store: deps.store, engine: deps.engine, now: deps.now },
    );
    return jsonText({
      artefact_id: args.artefact_id,
      children_mode: args.children_mode ?? 'replace',
      sections: result.sections,
    });
  } catch (err) {
    if (err instanceof WriteSectionError) {
      return text(formatError(args.artefact_id, err.message), true);
    }
    throw err;
  }
}

export function registerWriteSectionTool(
  server: McpServer, deps: ServerDeps,
): void {
  server.tool(
    WRITE_SECTION_TOOL,
    'Replace a section subtree in a document Digest with hash-locked ' +
    'optimistic locking. Use read_section first to get current hashes.',
    writeSectionSchema,
    (args) => handleWriteSection(args as WriteSectionArgs, deps),
  );
}
