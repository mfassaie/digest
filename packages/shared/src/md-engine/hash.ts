import { createHash } from 'node:crypto';

import type { BlockMeta, BlockType, SectionType } from './types.js';

// Hash composition per the decisions ledger (design §2.5, open question 6
// resolution): block = (type, value, meta); section = (type, title,
// ordered block hashes). Positions, depth, index, timestamps and
// DESCENDANT sections stay outside the lock, so a sibling insert or a
// child edit never invalidates an unrelated section's hash.

function sha256(input: string): string {
  return 'sha256:' + createHash('sha256').update(input, 'utf8').digest('hex');
}

// Deterministic meta encoding: keys sorted, undefined values dropped;
// absent and empty meta both hash as null so `{}` is not a distinct lock.
function canonicalMeta(
  meta: BlockMeta | undefined,
): Record<string, unknown> | null {
  if (!meta) return null;
  const entries = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

export function blockHash(
  type: BlockType, value: string, meta: BlockMeta | undefined,
): string {
  return sha256(JSON.stringify(['block', type, value, canonicalMeta(meta)]));
}

export function sectionHash(
  type: SectionType, title: string | undefined, blockHashes: string[],
): string {
  return sha256(JSON.stringify(['section', type, title ?? null, blockHashes]));
}
