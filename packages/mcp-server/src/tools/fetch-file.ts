import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchFileArtefact } from '@digest/shared';
import type { ServerDeps } from '../deps.js';
import {
  formatError, formatRedirect, jsonText, text, type TextResult,
} from '../response.js';

// The fetch_file tool (ADR-011 design §4): fetch a file into the artefact
// store and return its file Digest. One module per tool (plan M4);
// server.ts only registers.

export const FETCH_FILE_TOOL = 'fetch_file';

export const fetchFileSchema = {
  uri: z.string().describe(
    'https url, file:// url or local path. http upgrades to https.',
  ),
  chunk_mode: z.enum(['none', 'standard']).optional().default('none')
    .describe(
      "'standard' splits the file into chunks stored alongside the " +
      "artefact; default 'none'.",
    ),
};

export interface FetchFileArgs {
  uri: string;
  chunk_mode?: 'none' | 'standard';
}

export async function handleFetchFile(
  args: FetchFileArgs, deps: ServerDeps,
): Promise<TextResult> {
  const chunkMode = args.chunk_mode ?? 'none';
  const result = await fetchFileArtefact(deps, args.uri, chunkMode);
  switch (result.kind) {
    case 'digest':
      // The file Digest verbatim: the one response that carries file uris.
      return jsonText(result.digest);
    case 'redirect':
      return text(formatRedirect(result.fromUrl, result.toUrl));
    case 'error':
      return text(formatError(args.uri, result.reason), true);
  }
}

export function registerFetchFileTool(
  server: McpServer, deps: ServerDeps,
): void {
  server.tool(
    FETCH_FILE_TOOL,
    'Fetch a file (https url, file:// url or local path) into the local ' +
    'artefact store and return its file Digest: identity, content hash ' +
    "and stored path. With chunk_mode 'standard', splits the file into " +
    'chunks (sections for markdown, byte ranges otherwise). Accepts any ' +
    'file type.',
    fetchFileSchema,
    (args) => handleFetchFile(args, deps),
  );
}
