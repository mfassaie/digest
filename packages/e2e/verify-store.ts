// Verification: the full md fetch -> read -> write -> read-section round-trip,
// running against in-process tool handlers with NO Docker. Uses a local
// markdown file, a temporary artefact root, and workspace-imported handlers.
// fetch_file stores the raw file (type: file); read_document converts it to
// a document Digest (type: document) with sections; write_section and
// read_section operate on the document artefact.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleFetchFile, handleReadDocument,
  handleReadSection, handleWriteSection,
} from '@digest/mcp-server';
import { createArtefactStore, extractiveEngine } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

const root = mkdtempSync(join(tmpdir(), 'digest-store-'));
const store = createArtefactStore(root);
const deps = {
  store,
  settings: DEFAULT_SETTINGS,
  engine: extractiveEngine,
  logsDir: join(root, 'logs'),
};

const SAMPLE_MD = [
  '# Store round-trip test',
  '',
  'Preamble paragraph for the summary extractor.',
  '',
  '## Installation',
  '',
  'Run `npm install digest`.',
  '',
  '## Usage',
  '',
  'Call `fetch_file` then `read_document`.',
  '',
].join('\n');

const sampleFile = join(root, 'test.md');
writeFileSync(sampleFile, SAMPLE_MD, 'utf8');

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) process.exitCode = 1;
}

async function main(): Promise<void> {
  try {
    // Step 1: fetch_file (local file -> file-type artefact)
    console.log('--- Step 1: fetch_file ---');
    const fetchResult = await handleFetchFile({ uri: sampleFile }, deps);
    assert(!fetchResult.isError, 'fetch_file succeeds');
    const fileDigest = JSON.parse(fetchResult.content[0].text) as {
      id: string;
      type: string;
    };
    assert(fileDigest.type === 'file', 'fetch_file returns file-type artefact');
    assert(typeof fileDigest.id === 'string' && fileDigest.id.length === 22,
      'artefact id is 22 chars');

    // Step 2: read_document (converts file -> document artefact)
    console.log('\n--- Step 2: read_document ---');
    const readResult = await handleReadDocument(
      { resource: sampleFile, read_mode: 'all' }, deps,
    );
    assert(!readResult.isError, 'read_document succeeds');
    const doc = JSON.parse(readResult.content[0].text) as {
      id: string;
      type: string;
      document: {
        sections: {
          id: string;
          children?: { id: string; title?: string; hash: string }[];
        };
      };
    };
    assert(doc.type === 'document', 'read_document returns document-type');
    const docId = doc.id;
    const rootSection = doc.document.sections;
    assert(typeof rootSection.id === 'string', 'root section has an id');

    // Find the "Installation" section: h2 sections are children of the h1.
    type SectionNode = { id: string; title?: string; hash: string;
      children?: SectionNode[] };
    function findSection(
      node: SectionNode, title: string,
    ): SectionNode | undefined {
      if (node.title === title) return node;
      for (const child of node.children ?? []) {
        const found = findSection(child, title);
        if (found) return found;
      }
      return undefined;
    }
    const installSection = findSection(rootSection as SectionNode,
      'Installation');
    assert(installSection !== undefined, 'Installation section found');
    if (!installSection) throw new Error('cannot continue without section');

    // Step 3: read_section (pre-write)
    console.log('\n--- Step 3: read_section (pre-write) ---');
    const preRead = await handleReadSection({
      artefact_id: docId,
      section_id: installSection.id,
    }, deps);
    assert(!preRead.isError, 'read_section succeeds');
    const preSections = JSON.parse(preRead.content[0].text) as {
      sections: { id: string; hash: string; content?: unknown[] }[];
    };
    assert(preSections.sections.length === 1, 'one section returned');
    const preHash = preSections.sections[0].hash;

    // Step 4: write_section (replace content)
    console.log('\n--- Step 4: write_section ---');
    const writeResult = await handleWriteSection({
      artefact_id: docId,
      section: {
        id: installSection.id,
        hash: preHash,
        content: [
          { type: 'paragraph', value: 'Updated installation instructions.' },
          { type: 'code', value: 'npm install @mfassaie/digest',
            meta: { lang: 'sh' } },
        ],
      },
      children_mode: 'replace',
    }, deps);
    assert(!writeResult.isError, 'write_section succeeds');
    const writeOut = JSON.parse(writeResult.content[0].text) as {
      sections: SectionNode;
    };
    // The hash must have changed after the write. Walk the tree to find
    // the updated installation section (same nesting as read_document).
    const updatedChild = findSection(writeOut.sections, 'Installation');
    const postHash = updatedChild?.hash;
    assert(postHash !== undefined && postHash !== preHash,
      'section hash changed after write');

    // Step 5: read_section (post-write, verify round-trip)
    console.log('\n--- Step 5: read_section (post-write) ---');
    const postRead = await handleReadSection({
      artefact_id: docId,
      section_id: installSection.id,
    }, deps);
    assert(!postRead.isError, 'read_section post-write succeeds');
    const postText = postRead.content[0].text;
    assert(postText.includes('Updated installation instructions'),
      'written content is readable');
    assert(postText.includes('@mfassaie/digest'),
      'code block content preserved');

    // Step 6: write with stale hash should fail
    console.log('\n--- Step 6: write with stale hash ---');
    const staleWrite = await handleWriteSection({
      artefact_id: docId,
      section: {
        id: installSection.id,
        hash: preHash, // stale
        content: [{ type: 'paragraph', value: 'Should not land.' }],
      },
      children_mode: 'replace',
    }, deps);
    assert(staleWrite.isError === true, 'stale-hash write rejected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const passed = process.exitCode !== 1;
  console.log(passed ? '\nOK: store round-trip verified' : '\nFAILED');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
