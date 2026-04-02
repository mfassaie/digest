import { execFile } from 'node:child_process';
import { DockerUnavailableError } from '@digest/shared';
import {
  checkHealth, checkMinVersion, type HealthStatus,
} from './container-client.js';

export { DockerUnavailableError };

export const IMAGE = 'digest:local';
export const CONTAINER = 'digest';
const SERVICE_PORT = 8932;
const HEALTH_BUDGET_MS = 20_000;

// execFile-style runner (argument arrays, no shell) so Windows paths are not
// mangled by a shell. Faked in unit tests.
export interface CommandRunner {
  exec(
    cmd: string, args: string[], timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

export const realRunner: CommandRunner = {
  exec(cmd, args, timeoutMs) {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === 'number'
          ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ stdout, stderr, code });
      });
    });
  },
};

const SETUP_HINT =
  'Run `npx digest setup` to build the local Docker image.';

export async function detectDocker(r: CommandRunner): Promise<void> {
  const res = await r.exec(
    'docker', ['version', '--format', '{{.Server.Version}}'], 10_000,
  );
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new DockerUnavailableError(
      'Docker is not available or not running.\n' +
      'Install Docker Desktop and start it: https://docs.docker.com/get-docker/\n' +
      `Then ${SETUP_HINT}`,
    );
  }
}

export async function imagePresent(r: CommandRunner): Promise<boolean> {
  const res = await r.exec('docker', ['image', 'inspect', IMAGE], 10_000);
  return res.code === 0;
}

type State = 'absent' | 'running' | 'stopped';

async function containerState(r: CommandRunner): Promise<State> {
  const res = await r.exec(
    'docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], 10_000,
  );
  if (res.code !== 0) return 'absent';
  return res.stdout.trim() === 'true' ? 'running' : 'stopped';
}

async function mappedPort(r: CommandRunner): Promise<number> {
  const res = await r.exec(
    'docker', ['port', CONTAINER, String(SERVICE_PORT)], 10_000,
  );
  // e.g. "127.0.0.1:32769" (possibly multiple lines for v4/v6)
  const m = res.stdout.match(/:(\d+)\s*$/m);
  if (!m) throw new DockerUnavailableError(
    `Could not determine mapped port for ${CONTAINER}.`,
  );
  return Number(m[1]);
}

// Ensure the (single, shared) container is running and healthy, returning its
// base URL. The container is artefact-root-agnostic — it returns content over
// HTTP and the host writes it — so there is no bind-mount.
export async function ensureContainer(
  r: CommandRunner,
  opts: {
    healthCheck?: (baseUrl: string) => Promise<HealthStatus>;
  } = {},
): Promise<{ baseUrl: string }> {
  await detectDocker(r);
  if (!await imagePresent(r)) {
    throw new DockerUnavailableError(
      `The ${IMAGE} image is not built. ${SETUP_HINT}`,
    );
  }

  const state = await containerState(r);
  if (state === 'absent') {
    const args = [
      'run', '-d', '--name', CONTAINER, '--init',
      '-p', `127.0.0.1:0:${SERVICE_PORT}`,
      IMAGE,
    ];
    const res = await r.exec('docker', args, 30_000);
    if (res.code !== 0) {
      throw new DockerUnavailableError(
        `Failed to start ${CONTAINER}: ${res.stderr.trim()}`,
      );
    }
  } else if (state === 'stopped') {
    const res = await r.exec('docker', ['start', CONTAINER], 15_000);
    if (res.code !== 0) {
      throw new DockerUnavailableError(
        `Failed to start ${CONTAINER}: ${res.stderr.trim()}`,
      );
    }
  }

  const port = await mappedPort(r);
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(baseUrl, opts.healthCheck ?? checkHealth);
  // M9 version gate (ADR-010 section 4.5): fail loudly when the running
  // container is too old for the instruction protocol.
  const versionHint = checkMinVersion(health);
  if (versionHint !== null) {
    throw new DockerUnavailableError(versionHint);
  }
  return { baseUrl };
}

async function waitForHealth(
  baseUrl: string,
  health: (b: string) => Promise<HealthStatus>,
): Promise<HealthStatus> {
  const deadline = Date.now() + HEALTH_BUDGET_MS;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const h = await health(baseUrl);
      if (h.cdpConnected) return h;
      lastErr = `status=${h.status ?? 'unknown'}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new DockerUnavailableError(
    `${CONTAINER} did not become healthy within ` +
    `${HEALTH_BUDGET_MS / 1000}s (${lastErr}).\n` +
    `Check \`docker logs ${CONTAINER}\`.`,
  );
}
