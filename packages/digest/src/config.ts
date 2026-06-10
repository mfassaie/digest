import { join } from 'node:path';
import { homedir } from 'node:os';

// Per-session configuration from the MCP `env` block.
// DIGEST_DOCUMENT_ROOT: base dir holding cache/ and logs/ (default
//   ~/.claude/digest). Different sessions may set different roots — the
//   container is document-root-agnostic and the host writes here.
// DIGEST_REPO_ROOT: if set, the bin runs the server from the repo source
//   under a watcher (dev mode).

export function getDocumentRoot(override?: string): string {
  return override
    ?? process.env.DIGEST_DOCUMENT_ROOT
    ?? join(homedir(), '.claude', 'digest');
}

export function getCacheRoot(documentRoot?: string): string {
  return join(getDocumentRoot(documentRoot), 'cache');
}

export function getLogsDir(documentRoot?: string): string {
  return join(getDocumentRoot(documentRoot), 'logs');
}

export function getRepoRoot(): string | undefined {
  const r = process.env.DIGEST_REPO_ROOT;
  return r && r.trim() ? r : undefined;
}

export function isDevMode(): boolean {
  return getRepoRoot() !== undefined;
}
