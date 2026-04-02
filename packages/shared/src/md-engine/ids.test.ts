import { describe, expect, it } from 'vitest';

import { mintId } from './ids.js';

describe('mintId', () => {
  it('mints 22-char base64url ids (16 random bytes, §2.4)', () => {
    for (let i = 0; i < 50; i++) {
      expect(mintId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('does not repeat across mints', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => mintId()));
    expect(ids.size).toBe(1000);
  });
});
