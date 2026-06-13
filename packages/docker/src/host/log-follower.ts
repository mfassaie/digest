import { spawn } from 'node:child_process';
import {
  followLinesAsJsonl, getLogsDir, openDocServiceLog,
} from '@digest/shared';
import { CONTAINER } from './docker.js';

let followerStarted = false;
let recentExits: number[] = [];

const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

// Spawn one `docker logs -f` follower for this host process, mirroring the
// shared container's output (cloakserve / CloakBrowser / Xvfb) into
// <logs>/doc-service.jsonl as {ts, stream, line} records (ADR-011 design
// §3 — was cloakbrowser.log). Idempotent. Lives here, not in shared
// logging: following a container is a Docker concern.
export function startBrowserLogFollower(): void {
  if (followerStarted) return;

  // Crash-loop guard: refuse to spawn if the child has exited
  // too many times within the recent window.
  const now = Date.now();
  recentExits = recentExits.filter(t => now - t < CRASH_WINDOW_MS);
  if (recentExits.length >= CRASH_LIMIT) {
    console.warn(
      '[digest] log-follower crash-loop detected'
      + ` (${CRASH_LIMIT} exits in ${CRASH_WINDOW_MS / 1000}s), skipping`,
    );
    return;
  }

  followerStarted = true;
  try {
    const writer = openDocServiceLog(getLogsDir());
    const child = spawn(
      'docker', ['logs', '-f', '--tail', '0', CONTAINER],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    followLinesAsJsonl(child.stdout, writer, { stream: 'stdout' });
    followLinesAsJsonl(child.stderr, writer, { stream: 'stderr' });
    child.on('error', () => { followerStarted = false; });
    child.on('exit', () => {
      followerStarted = false;
      recentExits.push(Date.now());
      recentExits = recentExits.filter(
        t => Date.now() - t < CRASH_WINDOW_MS,
      );
    });
    child.unref();
  } catch {
    followerStarted = false;
  }
}
