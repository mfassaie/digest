import { appendFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getLogsDir } from './config.js';
import { CONTAINER } from './docker.js';

// All server logs live under <document-root>/logs. The host server also keeps
// writing to stderr (stdout is the MCP protocol). A follower mirrors the
// shared container's output (cloakserve / CloakBrowser / Xvfb) into a file.

function ensureLogsDir(): string {
  const dir = getLogsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function logLine(level: 'info' | 'error', msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(join(ensureLogsDir(), 'digest-server.log'), line);
  } catch {
    // never let logging break the server
  }
}

let followerStarted = false;

// Spawn one `docker logs -f` follower for this host process, mirroring the
// shared container's stdout/stderr into <logs>/cloakbrowser.log. Idempotent.
export function startBrowserLogFollower(): void {
  if (followerStarted) return;
  followerStarted = true;
  try {
    const out = createWriteStream(
      join(ensureLogsDir(), 'cloakbrowser.log'), { flags: 'a' },
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
