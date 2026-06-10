import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';

// Content categories used to branch storage and conversion.
export type ContentCategory = 'html' | 'text' | 'json' | 'binary';

export interface DocumentMeta {
  title?: string;
  description?: string;
  author?: string;
  published?: string;
  site?: string;
  language?: string;
  wordCount?: number;
  image?: string;
}

export interface ConvertResult {
  markdown: string;
  meta: DocumentMeta;
}

export function classifyContentType(contentType: string): ContentCategory {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return 'html';
  if (
    ct === 'text/plain' || ct === 'text/markdown' ||
    ct === 'text/xml' || ct === 'application/xml'
  ) return 'text';
  if (ct === 'application/json') return 'json';
  return 'binary';
}

const EXT_MAP: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'application/zip': 'zip',
};

export function getFileExtension(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return EXT_MAP[ct] ?? 'bin';
}

// HTML -> structured Markdown via defuddle, surfacing the metadata defuddle
// extracts (title/author/published/description/schema.org-derived fields).
// ADR-006: defuddle is the chosen converter, behind this interface so a
// swap after the real-corpus eval is a one-file change.
export async function convertHtml(
  html: string, url: string,
): Promise<ConvertResult> {
  const { document } = parseHTML(html);
  const r = await Defuddle(document, url, {
    markdown: true,
    // Deterministic, no third-party network calls during conversion.
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
