import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WORKER = join(here, 'worker.ts');

export const HARD_TIMEOUT_MS = 30_000;

export interface RunOutcome {
  converter: string;
  fixtureId: string;
  status: 'ok' | 'error' | 'timeout';
  ms?: number;
  peakRssBytes?: number;
  markdown?: string;
  title?: string | null;
  error?: string;
}

// Runs one (converter, fixture) conversion in a child tsx process with a
// hard wall-clock timeout. A hung or crashed converter cannot stall the run.
export function runConversion(
  converter: string,
  fixtureId: string,
): Promise<RunOutcome> {
  const tmp = mkdtempSync(join(tmpdir(), 'falk-eval-'));
  const outFile = join(tmp, 'out.json');

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx',
        WORKER, converter, fixtureId, outFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup({ converter, fixtureId, status: 'timeout' });
    }, HARD_TIMEOUT_MS);

    let done = false;
    function cleanup(outcome: RunOutcome): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rmSync(tmp, { recursive: true, force: true }); } catch {
        // best effort
      }
      resolve(outcome);
    }

    child.on('exit', (code) => {
      if (done) return;
      if (code !== 0) {
        cleanup({
          converter, fixtureId, status: 'error',
          error: stderr.trim() || `worker exited ${code}`,
        });
        return;
      }
      try {
        const raw = JSON.parse(readFileSync(outFile, 'utf8'));
        if (raw.ok) {
          cleanup({
            converter, fixtureId, status: 'ok',
            ms: raw.ms, peakRssBytes: raw.peakRssBytes,
            markdown: raw.markdown, title: raw.title,
          });
        } else {
          cleanup({
            converter, fixtureId, status: 'error', error: raw.error,
          });
        }
      } catch (err) {
        cleanup({
          converter, fixtureId, status: 'error',
          error: `result read failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    });
  });
}
