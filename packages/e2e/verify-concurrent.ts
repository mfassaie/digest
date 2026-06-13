// Verification: concurrent fetch_file calls do not lose index entries.
// Validates the ArtefactStore write queue serialises index mutations
// under parallel load. Uses local markdown files, a temporary artefact
// root, and the fetchFileArtefact pipeline with no Docker.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createArtefactStore, extractiveEngine, fetchFileArtefact,
} from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

const root = mkdtempSync(join(tmpdir(), 'digest-concurrent-'));
const store = createArtefactStore(root);
const deps = {
  store,
  settings: DEFAULT_SETTINGS,
  engine: extractiveEngine,
  logsDir: join(root, 'logs'),
};

const FILE_COUNT = 5;

// Create 5 distinct markdown files in a temp directory.
const srcDir = mkdtempSync(join(tmpdir(), 'digest-concurrent-src-'));
const filePaths: string[] = [];
for (let i = 0; i < FILE_COUNT; i++) {
  const md = [
    `# Document ${i}`,
    '',
    `Body text for document number ${i}.`,
    '',
  ].join('\n');
  const p = join(srcDir, `doc-${i}.md`);
  writeFileSync(p, md, 'utf8');
  filePaths.push(p);
}

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) process.exitCode = 1;
}

async function main(): Promise<void> {
  try {
    // Fire all 5 fetches in parallel.
    console.log('--- Concurrent fetch (5 files) ---');
    const results = await Promise.all(
      filePaths.map((p) => fetchFileArtefact(deps, p, 'none')),
    );

    // All should succeed.
    const ids: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      assert(r.kind === 'digest', `fetch ${i} succeeds`);
      if (r.kind === 'digest') {
        ids.push(r.digest.id);
      }
    }
    assert(ids.length === FILE_COUNT,
      `all ${FILE_COUNT} fetches returned digests`);

    // Drain the write queue before reading the index.
    await store.flush();

    // Read artefact-index.json and verify all IDs are present.
    console.log('\n--- Index integrity ---');
    const indexPath = join(root, 'artefact', 'artefact-index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as
      { artefact_id: string }[];
    assert(Array.isArray(index), 'index is an array');
    for (const id of ids) {
      const found = index.some((e) => e.artefact_id === id);
      assert(found, `index contains ${id}`);
    }
    assert(index.length === FILE_COUNT,
      `index has exactly ${FILE_COUNT} entries`);

    // Verify each digest.json parses correctly.
    console.log('\n--- Digest integrity ---');
    for (const id of ids) {
      const digest = await store.readDigest(id);
      assert(digest !== null, `digest.json for ${id} parses`);
      if (digest !== null) {
        assert(digest.type === 'file', `${id} is file-type`);
        assert(typeof digest.file.hash === 'string'
          && digest.file.hash.length > 0, `${id} has a hash`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  }

  const passed = process.exitCode !== 1;
  console.log(passed ? '\nOK: concurrent fetch verified' : '\nFAILED');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
