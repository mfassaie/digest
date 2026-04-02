import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, EXT_TO_MIME, loadSettings, resolveRuleForUri,
} from './index.js';

describe('settings barrel', () => {
  it('re-exports the schema, loader, mime and resolve surfaces', () => {
    expect(typeof loadSettings).toBe('function');
    expect(EXT_TO_MIME.md).toBe('text/markdown');
    expect(resolveRuleForUri(DEFAULT_SETTINGS, 'https://x.com/page'))
      .toEqual(DEFAULT_SETTINGS.types['text/html']);
  });
});
