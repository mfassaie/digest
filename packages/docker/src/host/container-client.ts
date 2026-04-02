import type {
  ContainerFetchRequest, ContainerFetchResponse,
} from '@digest/shared';

export interface HealthStatus {
  status: string;
  cdpConnected: boolean;
  version: string;
}

// M9: minimum container service version the host requires. A container
// reporting an older version triggers a setup hint (ADR-010 section 4.5).
export const MIN_SERVICE_VERSION = '0.3.0';

// Simple semver comparison: returns negative if a < b, 0 if equal,
// positive if a > b. Handles x.y.z only (sufficient for our versioning).
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// GET /healthz. Throws on network failure or non-JSON.
export async function checkHealth(
  baseUrl: string, timeoutMs = 3000,
): Promise<HealthStatus> {
  const res = await fetch(`${baseUrl}/healthz`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  return await res.json() as HealthStatus;
}

// Check whether the running container meets the minimum version. Returns
// null when OK, or a human-readable hint string when the version is too
// old. Callers (ensureContainer) use this after health is confirmed.
export function checkMinVersion(health: HealthStatus): string | null {
  if (compareSemver(health.version, MIN_SERVICE_VERSION) < 0) {
    return `Container version ${health.version} is older than the ` +
      `required ${MIN_SERVICE_VERSION}. ` +
      'Run `npx digest setup` to rebuild the image.';
  }
  return null;
}

// POST /fetch. The host-side abort fires at the container's own timeout plus
// a 10s margin, so the MCP server can never hang even if the container does.
// This is the core no-hang guarantee, held independently of the container.
export async function containerFetch(
  baseUrl: string, req: ContainerFetchRequest,
): Promise<ContainerFetchResponse> {
  const budgetMs = (req.timeoutSeconds + 10) * 1000;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(budgetMs),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? `Timeout after ${req.timeoutSeconds} seconds`
      : err instanceof Error ? err.message : String(err);
    return { outcome: 'fetch-failed', reason };
  }
  return await res.json() as ContainerFetchResponse;
}
