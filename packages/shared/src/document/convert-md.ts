import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDocLog } from '../jsonl-log.js';
import {
  computeExtracts, parseMarkdown,
  type ContentBlock as EngineBlock,
  type DocumentSection as EngineSection,
} from '../md-engine/index.js';
import { extensionOf } from '../settings/mime.js';
import { artefactId } from '../store/ids.js';
import type {
  ArtefactRelation, ContentBlock, Digest, DocumentSection,
} from '../store/record.js';
import type { PipelineDeps } from '../fetch/fetch-file.js';

// Markdown conversion, v1 (plan M4, ADR-011 §2.3 step 2): a straight copy
// of the source file becomes the document Digest's master md, folded into
// the section tree (M3) with extracts. Creates the related
// converted_from/converted_to pair both ways and records
// document.source_file_hash for the M7 divergence signal.

const MD_MIMES = new Set(['text/markdown', 'text/x-markdown']);
const MD_EXTS = new Set(['md', 'markdown']);

// v1 reads markdown only — not even txt (design §4). Raw md is often
// served as text/plain (raw.githubusercontent.com), so the file name's
// extension counts as well as the recorded mime type.
export function isMarkdownSource(
  file: { mime_type: string; name: string },
): boolean {
  if (MD_MIMES.has(file.mime_type)) return true;
  const ext = extensionOf(file.name);
  return ext !== undefined && MD_EXTS.has(ext);
}

// Pre-network check for read_document on a not-yet-fetched uri: only
// md-looking uris are worth fetching at all in v1.
export function isMarkdownUri(uri: string): boolean {
  const ext = extensionOf(uri);
  return ext !== undefined && MD_EXTS.has(ext);
}

// The persisted shape (store/record.ts) is the engine shape minus byte
// positions: splice always works from a fresh parse (M3 / plan risk
// table), so positions never enter digest.json.
export function toStoredSection(section: EngineSection): DocumentSection {
  const { position: _position, content, children, ...rest } = section;
  return {
    ...rest,
    ...(content === undefined
      ? {} : { content: content.map(toStoredBlock) }),
    ...(children === undefined
      ? {} : { children: children.map(toStoredSection) }),
  } as DocumentSection;
}

function toStoredBlock(block: EngineBlock): ContentBlock {
  const { position: _position, ...rest } = block;
  return rest as ContentBlock;
}

// Display name: the first titled heading section, else the file name
// (design §2.2: "file name or title heading").
function displayName(root: EngineSection, fileName: string): string {
  for (const child of root.children ?? []) {
    if (child.type === 'section' && child.title !== undefined
      && child.title.trim() !== '') {
      return child.title;
    }
  }
  return fileName;
}

function masterName(sourceName: string): string {
  const ext = extensionOf(sourceName);
  return ext !== undefined && MD_EXTS.has(ext)
    ? sourceName : `${sourceName}.md`;
}

function withRelation(
  related: ArtefactRelation[] | undefined, relation: ArtefactRelation,
): ArtefactRelation[] {
  const present = (related ?? []).some(
    (r) => r.id === relation.id && r.type === relation.type,
  );
  return present ? related! : [...(related ?? []), relation];
}

// Convert a markdown file Digest into its document Digest. Callers gate on
// isMarkdownSource first; this function trusts the bytes are markdown.
export async function convertMarkdownFile(
  deps: PipelineDeps, fileDigest: Digest,
): Promise<Digest> {
  const stamp = (deps.now?.() ?? new Date()).toISOString();
  const markdown = await readFile(
    join(deps.store.paths.artefactDir(fileDigest.id), fileDigest.file.name),
    'utf8',
  );
  const root = parseMarkdown(markdown, { now: stamp });
  const extracts = computeExtracts(root, { engine: deps.engine });
  const docId = artefactId(fileDigest.origin_uri, 'document');
  const log = deps.logsDir === undefined
    ? undefined : openDocLog(deps.logsDir, docId);
  log?.write({ event: 'convert-md', source: fileDigest.id });

  const document = await deps.store.createDigest({
    originUri: fileDigest.origin_uri,
    type: 'document',
    file: {
      name: masterName(fileDigest.file.name),
      mimeType: 'text/markdown',
      bytes: markdown,
    },
    document: {
      name: displayName(root, fileDigest.file.name),
      ...(extracts.summary === '' ? {} : { summary: extracts.summary }),
      ...(extracts.keywords.length === 0
        ? {} : { keywords: extracts.keywords }),
      // The md adapter writes everything (design §5.4a); write_section
      // itself lands in M6.
      writable: 'full',
      source_file_hash: fileDigest.file.hash,
      sections: toStoredSection(root),
    },
    related: [{ id: fileDigest.id, type: 'converted_from' }],
  });
  await deps.store.updateDigest(fileDigest.id, {
    mutate: (d) => {
      d.related = withRelation(
        d.related, { id: document.id, type: 'converted_to' },
      );
    },
  });
  log?.write({ event: 'converted', document: document.id });
  return document;
}
