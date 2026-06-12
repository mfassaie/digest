import {
  createArtefactStore, extractiveEngine, getArtefactRoot, getLogsDir,
} from '@digest/shared';
import { loadSettings } from '@digest/shared/settings';
import type { ServerDeps } from '@digest/mcp-server';

// Production wiring (the ServerDeps pattern): the artefact store under
// DIGEST_ARTEFACT_ROOT, machine-level settings (an invalid settings file
// is a hard startup error, ADR-007), the extractive read engine and the
// jsonl log root. The container transport returns in M9 — M4 runs the
// local pipeline only, so the server has no docker dependency.
export function defaultDeps(): ServerDeps {
  const root = getArtefactRoot();
  return {
    store: createArtefactStore(root),
    settings: loadSettings().settings,
    engine: extractiveEngine,
    logsDir: getLogsDir(root),
  };
}
