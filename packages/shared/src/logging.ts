import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getLogsDir } from './config.js';

// All server logs live under <artefact-root>/logs. The host server also keeps
// writing to stderr (stdout is the MCP protocol). The container log follower
// is a Docker concern and lives in @digest/docker (log-follower.ts).

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
