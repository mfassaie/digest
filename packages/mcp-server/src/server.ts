import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerDeps } from './deps.js';
import { registerFetchFileTool } from './tools/fetch-file.js';
import { registerReadDocumentTool } from './tools/read-document.js';
import { registerReadSectionTool } from './tools/read-section.js';

// Plan M4 architectural rule: one module per tool under tools/, and this
// file ONLY registers them — M5–M8 each add a tool module without
// touching the others.
export function createServer(deps: ServerDeps, version = '0.0.0'): McpServer {
  const server = new McpServer({ name: 'digest', version });
  registerFetchFileTool(server, deps);
  registerReadDocumentTool(server, deps);
  registerReadSectionTool(server, deps);
  return server;
}
