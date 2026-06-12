import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { SHORT_ID_RE, artefactId, isShortId, mintGuid } from './ids.js';

describe('artefactId', () => {
  const uri = 'https://docs.foo.dev/guide.md';

  it('is deterministic for the same uri and type', () => {
    expect(artefactId(uri, 'file')).toBe(artefactId(uri, 'file'));
    expect(artefactId(uri, 'document')).toBe(artefactId(uri, 'document'));
  });

  it('is base64url(sha256(uri + ":" + type)) truncated to 22 chars', () => {
    const expected = createHash('sha256')
      .update(`${uri}:file`)
      .digest('base64url')
      .slice(0, 22);
    expect(artefactId(uri, 'file')).toBe(expected);
  });

  it('derives distinct ids for file and document artefacts', () => {
    expect(artefactId(uri, 'file')).not.toBe(artefactId(uri, 'document'));
  });

  it('derives distinct ids for distinct uris', () => {
    expect(artefactId('https://a.dev/x', 'file'))
      .not.toBe(artefactId('https://a.dev/y', 'file'));
  });

  it('is 22 base64url chars', () => {
    expect(artefactId(uri, 'document')).toMatch(SHORT_ID_RE);
  });
});

describe('mintGuid', () => {
  it('mints 22-char base64url guids', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(mintGuid()).toMatch(SHORT_ID_RE);
    }
  });

  it('does not repeat across many mints', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => mintGuid()));
    expect(seen.size).toBe(1000);
  });
});

describe('isShortId', () => {
  it('accepts derived and minted ids', () => {
    expect(isShortId(artefactId('https://x.dev/', 'file'))).toBe(true);
    expect(isShortId(mintGuid())).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isShortId('')).toBe(false);
    expect(isShortId('A'.repeat(21))).toBe(false);
    expect(isShortId('A'.repeat(23))).toBe(false);
  });

  it('rejects non-base64url characters and path segments', () => {
    expect(isShortId(`${'A'.repeat(21)}+`)).toBe(false);
    expect(isShortId(`${'A'.repeat(21)}/`)).toBe(false);
    expect(isShortId(`${'A'.repeat(21)}=`)).toBe(false);
    expect(isShortId('../AAAAAAAAAAAAAAAAA/..')).toBe(false);
  });
});
