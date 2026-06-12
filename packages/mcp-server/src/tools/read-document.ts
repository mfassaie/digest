import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readDocumentArtefact } from '@digest/shared';
import type { ServerDeps } from '../deps.js';
import {
  formatError, formatRedirect, jsonText, projectDocumentDigest, text,
  type ReadMode, type TextResult,
} from '../response.js';
import { browserNeededMessage } from './fetch-file.js';

// The read_document tool (ADR-011 design §4): serve the document Digest —
// section tree, summary, keywords — with no uris in the response. One
// module per tool (plan M4); server.ts only registers.

export const READ_DOCUMENT_TOOL = 'read_document';

export const readDocumentSchema = {
  resource: z.string().describe(
    'uri (fetched on demand) or 22-char artefact id; a file id hops to ' +
    'its converted document.',
  ),
  read_mode: z.enum(['all', 'meta_only', 'sections_only'])
    .optional().default('all')
    .describe(
      "'all' = metadata + section tree; 'meta_only' drops the tree; " +
      "'sections_only' drops summary/keywords.",
    ),
};

export interface ReadDocumentArgs {
  resource: string;
  read_mode?: ReadMode;
}

// Format roadmap (design §4): v1 reads markdown only.
function unsupportedMessage(name: string, mime: string): string {
  return `read_document reads markdown (.md) sources only in this ` +
    `version — '${name}' is ${mime}. Format roadmap: html lands in M9, ` +
    'txt/json after that, pdf later. fetch_file can store the raw file ' +
    'meanwhile.';
}

export async function handleReadDocument(
  args: ReadDocumentArgs, deps: ServerDeps,
): Promise<TextResult> {
  const readMode = args.read_mode ?? 'all';
  const result = await readDocumentArtefact(deps, args.resource);
  switch (result.kind) {
    case 'document':
      return jsonText(projectDocumentDigest(
        result.digest, readMode, result.sourceChanged,
      ));
    case 'unsupported':
      return text(formatError(
        args.resource, unsupportedMessage(result.name, result.mime),
      ), true);
    case 'redirect':
      return text(formatRedirect(result.fromUrl, result.toUrl));
    case 'browser-needed':
      return text(
        formatError(args.resource, browserNeededMessage(result.mime)), true,
      );
    case 'error':
      return text(formatError(args.resource, result.reason), true);
  }
}

export function registerReadDocumentTool(
  server: McpServer, deps: ServerDeps,
): void {
  server.tool(
    READ_DOCUMENT_TOOL,
    'Read a fetched document as its structured Digest: section tree ' +
    '(table of contents), summary and keywords. No file paths in the ' +
    'response. Markdown sources only for now.',
    readDocumentSchema,
    (args) => handleReadDocument(args, deps),
  );
}
