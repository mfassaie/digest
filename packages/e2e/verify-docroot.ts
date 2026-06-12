// Live verification: with a custom DIGEST_ARTEFACT_ROOT, the host writes
// the container-returned content under <root>/cache, and read serves it.
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'digest-docroot-'));
process.env.DIGEST_ARTEFACT_ROOT = root;

// Imported after the env var is set so the wiring picks the custom root up.
const { handleGet, handleRead } = await import('@digest/mcp-server');
const {
  realRunner, ensureContainer, containerFetch, startBrowserLogFollower,
} = await import('@digest/docker');
const { getCacheDir, getCacheRoot, extractiveEngine } =
  await import('@digest/shared');

// Same wiring as the app's defaultDeps (app/digest/src/deps.ts).
const deps = {
  transport: {
    ensure: () => ensureContainer(realRunner, {}),
    fetch: containerFetch,
  },
  cacheRoot: getCacheRoot(),
  engine: extractiveEngine,
  onContainerReady: startBrowserLogFollower,
};

const url = 'https://quotes.toscrape.com/js/';

async function main(): Promise<void> {
  console.log(`artefact root = ${root}`);
  const get = await handleGet({ uri: url, timeout_seconds: 45 }, deps);
  console.log('--- get ---');
  console.log(get.content[0].text.split('\n').slice(0, 8).join('\n'));

  const dir = getCacheDir(url.replace(/^http:/, 'https:'));
  console.log(`\ncache dir under custom root: ${dir}`);
  console.log('is under custom root:', dir.startsWith(root));
  console.log('files:', existsSync(dir) ? readdirSync(dir) : '(none)');

  const read = await handleRead({ uri: url, mode: 'full' }, deps);
  console.log('\n--- read full (first 120 chars) ---');
  console.log(read.content[0].text.slice(0, 120));

  // A second fetch generates fresh container output for the log follower.
  await handleGet({ uri: 'https://example.com', timeout_seconds: 30 }, deps);
  const logsDir = join(root, 'logs');
  const { statSync } = await import('node:fs');
  console.log('\n--- logs ---');
  for (const f of existsSync(logsDir) ? readdirSync(logsDir) : []) {
    console.log(`  ${f}: ${statSync(join(logsDir, f)).size} bytes`);
  }

  await realRunner.exec('docker', ['rm', '-f', 'digest'], 30_000);
  rmSync(root, { recursive: true, force: true });
  console.log('\nOK: cleaned up');
}

main().catch((err) => { console.error(err); process.exit(1); });
