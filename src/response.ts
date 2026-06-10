import type { CacheMeta, Section } from './types.js';
import { formatOutline } from './structure.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface GetParams {
  meta: CacheMeta;
  dir: string;
  sections: Section[];
  rawSize: number;
  markdownSize?: number;
  source: 'fresh' | 'cache (validated)';
}

// falk_document_get success: metadata, file paths, section outline. Never
// the document body inline (ADR-003, scoped by ADR-008).
export function formatGet(p: GetParams): string {
  const m = p.meta;
  const lines: string[] = [
    `URL: ${m.url}`,
  ];
  if (m.finalUrl && m.finalUrl !== m.url) lines.push(`Final URL: ${m.finalUrl}`);
  lines.push(`Status: 200`, `Content-Type: ${m.contentType}`);
  if (m.title) lines.push(`Title: ${m.title}`);
  if (m.author) lines.push(`Author: ${m.author}`);
  if (m.published) lines.push(`Published: ${m.published}`);
  if (m.description) lines.push(`Description: ${m.description}`);
  if (m.wordCount) lines.push(`Word count: ${m.wordCount}`);

  lines.push('', 'Files:');
  if (m.markdownFile) lines.push(`  markdown: ${p.dir}/${m.markdownFile}`);
  lines.push(`  raw: ${p.dir}/${m.rawFile}`);

  lines.push('');
  const sizeParts: string[] = [];
  if (p.markdownSize !== undefined) {
    sizeParts.push(`${formatSize(p.markdownSize)} (markdown)`);
  }
  sizeParts.push(`${formatSize(p.rawSize)} (raw)`);
  lines.push(`Size: ${sizeParts.join(' | ')}`);
  lines.push(`Fetched: ${m.fetchedAt}`);
  lines.push(`Source: ${p.source}`);

  if (m.markdownFile) {
    lines.push('', `Sections (${p.sections.length}):`);
    lines.push(formatOutline(p.sections));
    lines.push('', 'Use falk_document_read with mode=sections|summary|' +
      'keywords|full (and section=<slug> for one section).');
  }
  return lines.join('\n');
}

export function formatError(url: string, reason: string): string {
  return `Error fetching ${url}\nReason: ${reason}`;
}

export function formatRedirect(fromUrl: string, toUrl: string): string {
  return [
    'Redirect detected (cross-host):',
    `  From: ${fromUrl}`,
    `  To: ${toUrl}`,
    '',
    'Make a new request with the redirect URL to fetch the content.',
  ].join('\n');
}
