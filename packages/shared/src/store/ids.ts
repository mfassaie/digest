import { createHash, randomUUID } from 'node:crypto';
import type { ArtefactType } from './record.js';

// Identity rules per ADR-011 (design §2.4). Both id families share one
// shape: 22 base64url chars (128 bits), so resource arguments can be
// disambiguated from uris by shape alone.
export const SHORT_ID_RE = /^[A-Za-z0-9_-]{22}$/;

// Deterministic artefact id: the same (normalised) origin uri and artefact
// type always derive the same id, in any session, at any time. File and
// document artefacts of one source get distinct ids because the type is
// part of the hashed input.
export function artefactId(originUri: string, type: ArtefactType): string {
  return createHash('sha256')
    .update(`${originUri}:${type}`)
    .digest('base64url')
    .slice(0, 22);
}

// Random sticky guid for sections and blocks: crypto.randomUUID re-encoded
// as base64url (16 bytes -> 22 chars). Minted once at first parse; retired
// ids are never reused (ADR-011).
export function mintGuid(): string {
  return Buffer.from(randomUUID().replaceAll('-', ''), 'hex')
    .toString('base64url');
}

export function isShortId(value: string): boolean {
  return SHORT_ID_RE.test(value);
}
