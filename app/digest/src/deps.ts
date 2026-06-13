import {
  createArtefactStore, extractiveEngine, getArtefactRoot, getLogsDir,
  type ContainerTransport,
  type ContainerFetchRequest,
  type ContainerFetchResponse,
} from '@digest/shared';
import { loadSettings } from '@digest/shared/settings';
import {
  ensureContainer, containerFetch, realRunner,
} from '@digest/docker';
import type { ServerDeps } from '@digest/mcp-server';

// M9: container transport wired from @digest/docker. The transport is
// lazy: ensureContainer runs only when a pipeline rule needs the container
// (design section 4.5). Results are cached for the session.
function createContainerTransport(): ContainerTransport {
  let cached: { baseUrl: string } | null = null;
  return {
    async ensure(): Promise<{ baseUrl: string }> {
      if (cached !== null) return cached;
      cached = await ensureContainer(realRunner);
      return cached;
    },
    async fetch(
      baseUrl: string, req: ContainerFetchRequest,
    ): Promise<ContainerFetchResponse> {
      return containerFetch(baseUrl, req);
    },
  };
}

// Production wiring (the ServerDeps pattern): the artefact store under
// DIGEST_ARTEFACT_ROOT, machine-level settings (an invalid settings file
// is a hard startup error, ADR-007), the extractive read engine, jsonl
// log root and the container transport from @digest/docker (M9).
export function defaultDeps(): ServerDeps {
  const root = getArtefactRoot();
  return {
    store: createArtefactStore(root),
    settings: loadSettings().settings,
    engine: extractiveEngine,
    logsDir: getLogsDir(root),
    containerTransport: createContainerTransport(),
  };
}
