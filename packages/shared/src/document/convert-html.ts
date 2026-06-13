import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

import { openDocLog } from '../jsonl-log.js';
import {
  computeExtracts, parseMarkdown,
  type ContentBlock as EngineBlock,
  type DocumentSection as EngineSection,
} from '../md-engine/index.js';
import { artefactId } from '../store/ids.js';
import type {
  ArtefactRelation, ContentBlock, Digest, DocumentSection,
} from '../store/record.js';
import type { PipelineDeps } from '../fetch/fetch-file.js';
import { toStoredSection } from './convert-md.js';

// HTML -> markdown conversion (plan M9, design §5.4a: extract adapter):
// defuddle + linkedom produces clean markdown from raw HTML, then the M3
// engine folds it into the DocumentSection tree. Creates the same
// converted_from/converted_to pair and source_file_hash divergence signal
// as convert-md. The defuddle/linkedom combo runs on the host (no browser
// DOM needed), so html documents fetched locally (runtime: local) or
// downloaded from the container get the same treatment.

const HTML_MIMES = new Set([
  'text/html', 'application/xhtml+xml',
]);

const HTML_EXTS = new Set(['html', 'htm', 'xhtml']);

function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

export function isHtmlSource(
  file: { mime_type: string; name: string },
): boolean {
  if (HTML_MIMES.has(file.mime_type)) return true;
  const ext = extensionOf(file.name);
  return ext !== undefined && HTML_EXTS.has(ext);
}

export function isHtmlUri(uri: string): boolean {
  // Extensionless URLs are provisionally text/html (design section 4.3),
  // but for pre-network gating we only accept explicitly html extensions.
  const ext = extensionOf(uri);
  return ext !== undefined && HTML_EXTS.has(ext);
}

export interface ConvertHtmlResult {
  markdown: string;
  meta: {
    title?: string;
    description?: string;
    author?: string;
    published?: string;
    site?: string;
    language?: string;
    wordCount?: number;
    image?: string;
  };
}

// ADR-006: defuddle is the chosen converter. parseHTML from linkedom
// supplies the DOM on the host side (no browser needed).
export async function defuddleHtml(
  html: string, url: string,
): Promise<ConvertHtmlResult> {
  const { document } = parseHTML(html);
  const r = await Defuddle(document, url, {
    markdown: true,
    useAsync: false,
  });
  return {
    markdown: r.content,
    meta: {
      title: r.title || undefined,
      description: r.description || undefined,
      author: r.author || undefined,
      published: r.published || undefined,
      site: r.site || undefined,
      language: r.language || undefined,
      wordCount: typeof r.wordCount === 'number' ? r.wordCount : undefined,
      image: r.image || undefined,
    },
  };
}

function displayName(root: EngineSection, fileName: string): string {
  for (const child of root.children ?? []) {
    if (child.type === 'section' && child.title !== undefined
      && child.title.trim() !== '') {
      return child.title;
    }
  }
  return fileName;
}

function masterMdName(sourceName: string): string {
  const ext = extensionOf(sourceName);
  if (ext !== undefined && HTML_EXTS.has(ext)) {
    return sourceName.replace(/\.[^.]+$/, '.md');
  }
  return `${sourceName}.md`;
}

function withRelation(
  related: ArtefactRelation[] | undefined, relation: ArtefactRelation,
): ArtefactRelation[] {
  const present = (related ?? []).some(
    (r) => r.id === relation.id && r.type === relation.type,
  );
  return present ? related! : [...(related ?? []), relation];
}

// Convert an HTML file Digest into its document Digest. Callers gate on
// isHtmlSource first; this function trusts the bytes are HTML.
export async function convertHtmlFile(
  deps: PipelineDeps, fileDigest: Digest,
): Promise<Digest> {
  const stamp = (deps.now?.() ?? new Date()).toISOString();
  const html = await readFile(
    join(deps.store.paths.artefactDir(fileDigest.id), fileDigest.file.name),
    'utf8',
  );
  const { markdown, meta } = await defuddleHtml(
    html, fileDigest.origin_uri,
  );
  const root = parseMarkdown(markdown, { now: stamp });
  const extracts = computeExtracts(root, { engine: deps.engine });
  const docId = artefactId(fileDigest.origin_uri, 'document');
  const log = deps.logsDir === undefined
    ? undefined : openDocLog(deps.logsDir, docId);
  log?.write({ event: 'convert-html', source: fileDigest.id });

  // Use the defuddle-extracted title when the markdown heading scan
  // produces nothing, and prefer it for the document name.
  const docName = meta.title
    ?? displayName(root, fileDigest.file.name);

  const document = await deps.store.createDigest({
    originUri: fileDigest.origin_uri,
    type: 'document',
    file: {
      name: masterMdName(fileDigest.file.name),
      mimeType: 'text/markdown',
      bytes: markdown,
    },
    document: {
      name: docName,
      ...(extracts.summary === '' ? {} : { summary: extracts.summary }),
      ...(extracts.keywords.length === 0
        ? {} : { keywords: extracts.keywords }),
      ...(meta.description === undefined
        ? {} : { description: meta.description }),
      // HTML documents are read-only in v1 (no write adapter).
      writable: 'none',
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
