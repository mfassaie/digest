import { win32 } from 'node:path';

// MIME helpers for rule resolution (per-type pipelines design §4.3).
//
// MIME_TO_EXT mirrors EXT_MAP in @digest/docker's service converter.
// Shared never depends on docker (ADR-010), so the table lives here as
// well; the docker-side copy is consolidated in the M9 service rework.
export const MIME_TO_EXT: Readonly<Record<string, string>> = {
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

// Inverse of MIME_TO_EXT. Where two MIME types share an extension the
// first listed wins (html → text/html, xml → text/xml).
export const EXT_TO_MIME: Readonly<Record<string, string>> = (() => {
  const inverse: Record<string, string> = {};
  for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
    inverse[ext] ??= mime;
  }
  return inverse;
})();

// 'text/HTML; charset=utf-8' → 'text/html'.
export function normaliseMime(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

// Lowercased extension (without the dot) of a URL's path or of a local
// file path; undefined when there is none.
export function extensionOf(uri: string): string | undefined {
  let pathPart: string;
  try {
    pathPart = new URL(uri).pathname;
  } catch {
    pathPart = uri; // not a URL: treat as a local filesystem path
  }
  // win32.extname handles both separator styles ('/' and '\').
  const ext = win32.extname(pathPart).toLowerCase();
  return ext.length > 1 ? ext.slice(1) : undefined;
}

// Provisional (pre-network) type for a URI: path extension → MIME via
// the inverse EXT_MAP; unknown or no extension resolves to text/html
// (design §4.3 — extensionless URLs are overwhelmingly pages).
export function provisionalMime(uri: string): string {
  const ext = extensionOf(uri);
  return (ext === undefined ? undefined : EXT_TO_MIME[ext]) ?? 'text/html';
}
