// Live end-to-end check of the host MCP handlers against a real container.
// Builds nothing; assumes `digest:local` image exists. Starts the
// container via the real docker lifecycle, runs fetch and
// read against live URLs, prints results. Not a unit test —
// run manually: `node --import tsx scripts/e2e-host.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGet, handleRead } from '../src/server.js';
import { realRunner, ensureContainer, CONTAINER } from '../src/docker.js';
import { containerFetch } from '../src/container-client.js';
import { extractiveEngine } from '../src/read-engine.js';

const cacheRoot = mkdtempSync(join(tmpdir(), 'falk-e2e-'));
const deps = {
  runner: realRunner,
  cacheRoot,
  ensureFn: ensureContainer,
  fetchFn: containerFetch,
  engine: extractiveEngine,
};

function show(label: string, r: { isError?: boolean; content: { text: string }[] }) {
  console.log(`\n--- ${label}${r.isError ? ' [isError]' : ''} ---`);
  console.log(r.content[0].text.slice(0, 700));
}

async function main(): Promise<void> {
  // Use a docs page with real headings so sections are exercised.
  const url = 'https://nodejs.org/api/process.html';
  show('get (docs page)', await handleGet({ uri: url, timeout_seconds: 40 }, deps));
  show('read sections', await handleRead({ uri: url, mode: 'sections' }, deps));
  show('read summary', await handleRead({ uri: url, mode: 'summary' }, deps));
  show('read keywords', await handleRead({ uri: url, mode: 'keywords' }, deps));

  // Second get should revalidate (ETag) -> cache (validated) if supported.
  show('get again (revalidate)', await handleGet({ uri: url, timeout_seconds: 40 }, deps));

  console.log('\nDone. Cleaning up container and cache.');
  await realRunner.exec('docker', ['rm', '-f', CONTAINER], 30_000);
  rmSync(cacheRoot, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
