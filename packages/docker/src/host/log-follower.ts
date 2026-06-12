import { spawn } from 'node:child_process';
import {
  followLinesAsJsonl, getLogsDir, openDocServiceLog,
} from '@digest/shared';
import { CONTAINER } from './docker.js';

let followerStarted = false;

// Spawn one `docker logs -f` follower for this host process, mirroring the
// shared container's output (cloakserve / CloakBrowser / Xvfb) into
// <logs>/doc-service.jsonl as {ts, stream, line} records (ADR-011 design
// §3 — was cloakbrowser.log). Idempotent. Lives here, not in shared
// logging: following a container is a Docker concern.
export function startBrowserLogFollower(): void {
  if (followerStarted) return;
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
    child.unref();
  } catch {
    followerStarted = false;
  }
}
