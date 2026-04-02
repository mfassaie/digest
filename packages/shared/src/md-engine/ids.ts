import { randomUUID } from 'node:crypto';

// Minted section/block ids: a random GUID encoded base64url, 22 chars
// (design §2.4, mirrored by the M2 store spec). Random minting is what
// makes "retired ids never reused" hold by construction; rematch.ts is
// what keeps live ids sticky across re-parses.
export function mintId(): string {
  const hex = randomUUID().replaceAll('-', '');
  return Buffer.from(hex, 'hex').toString('base64url');
}
