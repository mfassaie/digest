import type {
  ContainerFetchRequest, ContainerFetchResponse,
} from '@digest/shared';

export interface HealthStatus {
  status: string;
  cdpConnected: boolean;
  version: string;
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
