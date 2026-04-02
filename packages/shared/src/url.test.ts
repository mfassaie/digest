import { describe, it, expect } from 'vitest';
import { normaliseUrl } from './url.js';

describe('normaliseUrl', () => {
  it('upgrades http to https', () => {
    expect(normaliseUrl('http://example.com/a?b=1'))
      .toBe('https://example.com/a?b=1');
  });
  it('leaves https untouched', () => {
    expect(normaliseUrl('https://example.com/a')).toBe('https://example.com/a');
  });
  it('throws on an invalid URL', () => {
    expect(() => normaliseUrl('not a url')).toThrow();
  });
});
