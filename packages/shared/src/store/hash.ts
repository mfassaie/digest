import { createHash } from 'node:crypto';

// All stored hashes are sha256-prefixed strings (ADR-011): files, chunks,
// sections and blocks share the format, so every record is self-describing
// about the algorithm used.
export const HASH_STRING_RE = /^sha256:[0-9a-f]{64}$/;

// Content hash of bytes on disk (strings are hashed as utf8, matching what
// fs.writeFile persists for string inputs).
export function hashBytes(data: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function isHashString(value: string): boolean {
  return HASH_STRING_RE.test(value);
}
