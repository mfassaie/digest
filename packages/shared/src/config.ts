import { join } from 'node:path';
import { homedir } from 'node:os';

// Per-session configuration from the MCP `env` block. Roots are env-only
// (ADR-011) — behaviour lives in settings files (settings/).
// DIGEST_ARTEFACT_ROOT: base dir holding the artefact store, cache/ and
//   logs/ (default ~/.claude/digest). Different sessions may set different
//   roots — the container is root-agnostic and the host writes here.
// DIGEST_REPO_ROOT: if set, the bin runs the server from the repo source
//   under a watcher (dev mode).

export function getArtefactRoot(override?: string): string {
  return override
    ?? process.env.DIGEST_ARTEFACT_ROOT
    ?? join(homedir(), '.claude', 'digest');
}

export function getCacheRoot(artefactRoot?: string): string {
  return join(getArtefactRoot(artefactRoot), 'cache');
}

export function getLogsDir(artefactRoot?: string): string {
  return join(getArtefactRoot(artefactRoot), 'logs');
}

export function getRepoRoot(): string | undefined {
  const r = process.env.DIGEST_REPO_ROOT;
  return r && r.trim() ? r : undefined;
}

export function isDevMode(): boolean {
  return getRepoRoot() !== undefined;
}
