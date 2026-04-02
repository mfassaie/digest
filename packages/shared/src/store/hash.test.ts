import { describe, it, expect } from 'vitest';
import { HASH_STRING_RE, hashBytes, isHashString } from './hash.js';

describe('hashBytes', () => {
  it('produces the sha256-prefixed lowercase hex of the bytes', () => {
    // Known vector: sha256("abc").
    expect(hashBytes('abc')).toBe(
      'sha256:' +
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes strings as utf8, matching the equivalent bytes', () => {
    const text = 'café markdown';
    expect(hashBytes(text)).toBe(hashBytes(Buffer.from(text, 'utf8')));
  });

  it('matches HASH_STRING_RE for any input', () => {
    expect(hashBytes('')).toMatch(HASH_STRING_RE);
    expect(hashBytes(Buffer.from([0, 1, 2]))).toMatch(HASH_STRING_RE);
  });

  it('differs for different content', () => {
    expect(hashBytes('a')).not.toBe(hashBytes('b'));
  });
});

describe('isHashString', () => {
  it('accepts produced hashes', () => {
    expect(isHashString(hashBytes('x'))).toBe(true);
  });

  it('rejects bare hex, other prefixes, uppercase and short digests', () => {
    expect(isHashString('a'.repeat(64))).toBe(false);
    expect(isHashString(`md5:${'a'.repeat(64)}`)).toBe(false);
    expect(isHashString(`sha256:${'A'.repeat(64)}`)).toBe(false);
    expect(isHashString('sha256:abc')).toBe(false);
  });
});
