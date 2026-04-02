import { describe, it, expect } from 'vitest';
import {
  EXT_TO_MIME, MIME_TO_EXT, extensionOf, normaliseMime, provisionalMime,
} from './mime.js';

describe('EXT_TO_MIME', () => {
  it('inverts MIME_TO_EXT with first-listed-wins on collisions', () => {
    expect(EXT_TO_MIME.html).toBe('text/html');
    expect(EXT_TO_MIME.xml).toBe('text/xml');
    expect(EXT_TO_MIME.md).toBe('text/markdown');
    expect(EXT_TO_MIME.pdf).toBe('application/pdf');
    expect(EXT_TO_MIME.jpg).toBe('image/jpeg');
  });

  it('covers every extension in MIME_TO_EXT', () => {
    for (const ext of Object.values(MIME_TO_EXT)) {
      expect(EXT_TO_MIME[ext]).toBeDefined();
    }
  });
});

describe('normaliseMime', () => {
  it('lowercases and strips parameters', () => {
    expect(normaliseMime('text/HTML; charset=utf-8')).toBe('text/html');
    expect(normaliseMime('  Application/JSON ')).toBe('application/json');
    expect(normaliseMime('text/markdown')).toBe('text/markdown');
  });
});

describe('extensionOf', () => {
  it('reads the extension from a URL path, ignoring the query', () => {
    expect(extensionOf('https://x.com/a/report.PDF?dl=1')).toBe('pdf');
    expect(extensionOf('https://x.com/notes.md#top')).toBe('md');
  });

  it('returns undefined for extensionless URLs', () => {
    expect(extensionOf('https://x.com')).toBeUndefined();
    expect(extensionOf('https://x.com/docs/')).toBeUndefined();
    expect(extensionOf('https://x.com/api/v1.2/items')).toBeUndefined();
  });

  it('handles local paths on both separator styles', () => {
    expect(extensionOf('C:\\docs\\paper.pdf')).toBe('pdf');
    expect(extensionOf('/home/m/notes.md')).toBe('md');
    expect(extensionOf('file:///C:/docs/paper.pdf')).toBe('pdf');
  });

  it('treats dotfiles and trailing dots as extensionless', () => {
    expect(extensionOf('/srv/.gitignore')).toBeUndefined();
    expect(extensionOf('https://x.com/file.')).toBeUndefined();
  });
});

describe('provisionalMime', () => {
  it('maps a known extension via the inverse EXT_MAP', () => {
    expect(provisionalMime('https://x.com/a.md')).toBe('text/markdown');
    expect(provisionalMime('https://x.com/a.json')).toBe('application/json');
  });

  it('falls back to text/html for unknown or missing extensions', () => {
    expect(provisionalMime('https://x.com/archive.tar.gz')).toBe('text/html');
    expect(provisionalMime('https://x.com/page')).toBe('text/html');
    expect(provisionalMime('https://x.com')).toBe('text/html');
  });
});
