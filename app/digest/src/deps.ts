import { getCacheRoot, extractiveEngine } from '@digest/shared';
import {
  realRunner, ensureContainer, containerFetch, startBrowserLogFollower,
} from '@digest/docker';
import type { ServerDeps } from '@digest/mcp-server';

// Production wiring: the app injects @digest/docker's container transport
// into the mcp-server dispatch surface (the ServerDeps pattern — shared and
// mcp-server never depend on docker).
export function defaultDeps(): ServerDeps {
  return {
    transport: {
      ensure: () => ensureContainer(realRunner, {}),
      fetch: containerFetch,
    },
    cacheRoot: getCacheRoot(),
    engine: extractiveEngine,
    onContainerReady: startBrowserLogFollower,
  };
}
