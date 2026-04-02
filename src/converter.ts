import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import type { ContentCategory } from './types.js';

export interface ProcessedContent {
  raw: Buffer;
  markdown?: string;
  ext: string;
}

export function classifyContentType(
  contentType: string,
): ContentCategory {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    return 'html';
  }
  if (
    ct === 'text/plain' ||
    ct === 'text/markdown' ||
    ct === 'text/xml' ||
    ct === 'application/xml'
  ) {
    return 'text';
  }
  if (ct === 'application/json') {
    return 'json';
  }
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
};

export function getFileExtension(contentType: string): string {
  const ct = contentType.toLowerCase().split(';')[0].trim();
  return EXT_MAP[ct] ?? 'bin';
}

export async function convertHtml(
  html: string, url: string,
): Promise<string> {
  const { document } = parseHTML(html);
  const result = await Defuddle(
    document, url, { markdown: true }
  );
  return result.content;
}

export async function processContent(
  body: Buffer, contentType: string, url: string,
): Promise<ProcessedContent> {
  const category = classifyContentType(contentType);
  const ext = getFileExtension(contentType);

  if (category === 'html') {
    const html = body.toString('utf8');
    const markdown = await convertHtml(html, url);
    return { raw: body, markdown, ext };
  }

  if (category === 'json') {
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      const pretty = JSON.stringify(parsed, null, 2);
      return { raw: Buffer.from(pretty, 'utf8'), ext };
    } catch {
      return { raw: body, ext };
    }
  }

  return { raw: body, ext };
}
