import { describe, it, expect } from 'vitest';
import { SettingsError, mergeSettings } from './loader.js';
import { DEFAULT_SETTINGS } from './schema.js';
import {
  matchMimePattern, resolveRule, resolveRuleForUri,
} from './resolve.js';

// A settings fixture with all three specificities populated.
const settings = mergeSettings({
  types: {
    'text/markdown': {
      retrieval: 'http', parser: 'passthrough', runtime: 'local',
    },
    'image/*': { retrieval: 'http', parser: 'raw', runtime: 'local' },
  },
});

describe('resolveRule', () => {
  it('prefers an exact match over wildcards', () => {
    expect(resolveRule(settings, 'text/markdown').parser)
      .toBe('passthrough');
    expect(resolveRule(settings, 'text/html').retrieval).toBe('browser');
  });

  it('prefers type/* over */*', () => {
    expect(resolveRule(settings, 'image/png').runtime).toBe('local');
    expect(resolveRule(settings, 'image/avif').runtime).toBe('local');
    expect(resolveRule(settings, 'video/mp4').runtime).toBe('container');
  });

  it('strips parameters and case before matching', () => {
    expect(resolveRule(settings, 'Text/Markdown; charset=utf-8').parser)
      .toBe('passthrough');
  });

  it('falls back to */* for malformed content types', () => {
    expect(resolveRule(settings, 'garbage')).toEqual(
      DEFAULT_SETTINGS.types['*/*'],
    );
  });

  it('throws when effective settings lack a */* rule', () => {
    const broken = { ...settings, types: { 'text/html': settings.types['text/html'] } };
    expect(() => resolveRule(broken, 'video/mp4'))
      .toThrowError(SettingsError);
  });
});

describe('resolveRuleForUri (provisional)', () => {
  it('maps known extensions through the inverse EXT_MAP', () => {
    expect(resolveRuleForUri(settings, 'https://x.com/README.md').parser)
      .toBe('passthrough');
    expect(resolveRuleForUri(settings, 'https://x.com/logo.png').runtime)
      .toBe('local');
    expect(resolveRuleForUri(settings, 'https://x.com/a.pdf?dl=1'))
      .toEqual(DEFAULT_SETTINGS.types['*/*']);
  });

  it('resolves unknown or missing extensions to the text/html rule', () => {
    for (const uri of [
      'https://x.com/blog/post',
      'https://x.com/archive.tar.gz',
      'https://x.com',
    ]) {
      expect(resolveRuleForUri(settings, uri)).toEqual(
        DEFAULT_SETTINGS.types['text/html'],
      );
    }
  });

  it('handles local file paths', () => {
    expect(resolveRuleForUri(settings, 'C:\\notes\\todo.md').parser)
      .toBe('passthrough');
  });
});

describe('matchMimePattern', () => {
  it('is generic over the chunking strategy map', () => {
    const chunking = mergeSettings({}).chunking.standard;
    expect(matchMimePattern(chunking, 'text/markdown'))
      .toEqual({ strategy: 'sections' });
    expect(matchMimePattern(chunking, 'application/zip'))
      .toEqual({ strategy: 'bytes', chunk_bytes: 1_048_576 });
  });

  it('returns undefined when nothing matches', () => {
    expect(matchMimePattern({ 'text/plain': 1 }, 'image/png'))
      .toBeUndefined();
  });
});
