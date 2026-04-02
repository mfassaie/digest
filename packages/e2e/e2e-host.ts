// Live end-to-end check of the host MCP handlers on the M4 md-only flow.
// No Docker needed: the local http engine fetches a real markdown url,
// the host writes the file Digest, read_document converts (straight copy
// + fold) and serves the section tree, and a second fetch revalidates via
// the stored ETag. Not a unit test — run manually:
// `node --import tsx packages/e2e/e2e-host.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFetchFile, handleReadDocument } from '@digest/mcp-server';
import {
  artefactId, createArtefactStore, extractiveEngine,
} from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

const root = mkdtempSync(join(tmpdir(), 'digest-e2e-'));
const deps = {
  store: createArtefactStore(root),
  settings: DEFAULT_SETTINGS,
  engine: extractiveEngine,
  logsDir: join(root, 'logs'),
};

function show(
  label: string, r: { isError?: boolean; content: { text: string }[] },
): void {
  console.log(`\n--- ${label}${r.isError ? ' [isError]' : ''} ---`);
  console.log(r.content[0].text.slice(0, 900));
}

async function main(): Promise<void> {
  // A real markdown file with headings, served over plain http(s).
  const url = 'https://raw.githubusercontent.com/mfassaie/digest/main/README.md';

  show('fetch_file (md url)', await handleFetchFile({ uri: url }, deps));
  show(
    'read_document (same uri)',
    await handleReadDocument({ resource: url, read_mode: 'all' }, deps),
  );
  show(
    'read_document meta_only',
    await handleReadDocument(
      { resource: url, read_mode: 'meta_only' }, deps,
    ),
  );
  show(
    'read_document (file id, hops converted_to)',
    await handleReadDocument(
      { resource: artefactId(url, 'file') }, deps,
    ),
  );
  // Second fetch should send the stored validators -> 304 -> store serve.
  show('fetch_file again (revalidate)',
    await handleFetchFile({ uri: url }, deps));
  // The md-only v1 boundary: a non-md source names the roadmap.
  show('read_document (non-md url)', await handleReadDocument(
    { resource: 'https://raw.githubusercontent.com/mfassaie/digest/main/LICENSE' },
    deps,
  ));

  console.log('\nDone. Cleaning up the artefact root.');
  rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
