// Verification: with a custom DIGEST_ARTEFACT_ROOT, the host writes the
// artefact store under that root (host-side writing, ADR-009). Fully
// offline on the M4 md-only flow: fetch_file reads a local markdown file,
// read_document converts and serves it. No Docker, no network.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from
  'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'digest-docroot-'));
process.env.DIGEST_ARTEFACT_ROOT = root;

// Imported after the env var is set so the wiring picks the custom root up.
const { handleFetchFile, handleReadDocument } =
  await import('@digest/mcp-server');
const { createArtefactStore, extractiveEngine, getArtefactRoot } =
  await import('@digest/shared');
const { DEFAULT_SETTINGS } = await import('@digest/shared/settings');

// Same wiring shape as the app's defaultDeps (app/digest/src/deps.ts),
// with deterministic settings.
const deps = {
  store: createArtefactStore(getArtefactRoot()),
  settings: DEFAULT_SETTINGS,
  engine: extractiveEngine,
  logsDir: join(getArtefactRoot(), 'logs'),
};

const sample = join(root, 'sample.md');
writeFileSync(sample, [
  '# Sample document', '',
  'A local markdown file for the doc-root verification.', '',
  '## Details', '', 'Host-side writing only (ADR-009).', '',
].join('\n'), 'utf8');

async function main(): Promise<void> {
  console.log(`artefact root = ${root}`);

  const fetched = await handleFetchFile({ uri: sample }, deps);
  console.log('\n--- fetch_file (local md) ---');
  console.log(fetched.content[0].text.split('\n').slice(0, 10).join('\n'));

  const digest = JSON.parse(fetched.content[0].text) as {
    id: string; file: { uri: string };
  };
  const artefactDir = deps.store.paths.artefactDir(digest.id);
  console.log(`\nartefact dir under custom root: ${artefactDir}`);
  console.log('is under custom root:', artefactDir.startsWith(root));
  console.log('files:',
    existsSync(artefactDir) ? readdirSync(artefactDir) : '(none)');

  const read = await handleReadDocument({ resource: sample }, deps);
  console.log('\n--- read_document (first 400 chars) ---');
  console.log(read.content[0].text.slice(0, 400));
  const noUris = !read.content[0].text.includes('file://');
  console.log('response carries no file uris:', noUris);

  const indexPath = deps.store.paths.indexPath;
  console.log('\nindex written:', existsSync(indexPath), `(${indexPath})`);
  const logsDir = join(root, 'logs', 'docs');
  console.log('doc logs:',
    existsSync(logsDir) ? readdirSync(logsDir) : '(none)');

  const ok = artefactDir.startsWith(root) && existsSync(indexPath)
    && !read.isError && noUris;
  rmSync(root, { recursive: true, force: true });
  console.log(ok ? '\nOK: cleaned up' : '\nFAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
