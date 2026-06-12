import { createWriteStream, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getLogsDir } from '@digest/shared';
import { CONTAINER } from './docker.js';

let followerStarted = false;

// Spawn one `docker logs -f` follower for this host process, mirroring the
// shared container's output (cloakserve / CloakBrowser / Xvfb) into
// <logs>/cloakbrowser.log. Idempotent. Lives here, not in shared logging:
// following a container is a Docker concern.
export function startBrowserLogFollower(): void {
  if (followerStarted) return;
  followerStarted = true;
  try {
    const dir = getLogsDir();
    mkdirSync(dir, { recursive: true });
    const out = createWriteStream(
      join(dir, 'cloakbrowser.log'), { flags: 'a' },
    );
    const child = spawn(
      'docker', ['logs', '-f', '--tail', '0', CONTAINER],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('error', () => { followerStarted = false; });
    child.unref();
  } catch {
    followerStarted = false;
  }
}
