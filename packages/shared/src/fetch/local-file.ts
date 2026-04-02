import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXT_TO_MIME, extensionOf } from '../settings/mime.js';
import { normaliseUrl } from '../url.js';

// Resource classification and `file://`/local-path reads (plan M4):
// fetch_file accepts https urls, file:// urls and plain filesystem paths.
// Every form normalises to one canonical uri so artefact ids stay
// deterministic across input spellings (ADR-011 §2.4) — local paths
// canonicalise to their absolute file:// url.

export type ClassifiedResource =
  | { kind: 'web'; url: string }
  | { kind: 'file'; url: string; path: string }
  | { kind: 'invalid'; reason: string };

// Matches an explicit `scheme://` prefix, so a malformed web uri is
// reported as invalid instead of being misread as a relative path.
const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function classifyResource(raw: string): ClassifiedResource {
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    if (EXPLICIT_SCHEME_RE.test(raw)) {
      return { kind: 'invalid', reason: `invalid URL: ${raw}` };
    }
    return localPath(raw); // bare or relative filesystem path
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    try {
      return { kind: 'web', url: normaliseUrl(raw) };
    } catch {
      return { kind: 'invalid', reason: `invalid URL: ${raw}` };
    }
  }
  if (parsed.protocol === 'file:') {
    try {
      return localPath(fileURLToPath(parsed));
    } catch {
      return { kind: 'invalid', reason: `invalid file:// URL: ${raw}` };
    }
  }
  // A Windows drive path ('C:\docs\a.md') parses as a URL with a
  // single-letter scheme; treat it as the path it is.
  if (/^[a-z]:$/.test(parsed.protocol)) {
    return localPath(raw);
  }
  return {
    kind: 'invalid',
    reason: `unsupported scheme: ${parsed.protocol} (use https, ` +
      'file:// or a local path)',
  };
}

function localPath(path: string): ClassifiedResource {
  const absolute = resolve(path);
  return { kind: 'file', url: pathToFileURL(absolute).href, path: absolute };
}

export interface LocalFileContent {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

// Extension-derived type for files that carry no Content-Type header.
export function mimeForFileName(name: string): string {
  const ext = extensionOf(name);
  return (ext === undefined ? undefined : EXT_TO_MIME[ext])
    ?? 'application/octet-stream';
}

export async function readLocalFile(path: string): Promise<LocalFileContent> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`cannot read local file (not found): ${path}`);
  }
  if (!info.isFile()) {
    throw new Error(`not a file: ${path}`);
  }
  const bytes = new Uint8Array(await readFile(path));
  const name = basename(path);
  return { name, mimeType: mimeForFileName(name), bytes };
}
