import { describe, it, expect } from 'vitest';
import {
  classifyContentType, getFileExtension, convertHtml,
} from './converter.js';

describe('classifyContentType', () => {
  it('classifies html', () => {
    expect(classifyContentType('text/html; charset=utf-8')).toBe('html');
    expect(classifyContentType('application/xhtml+xml')).toBe('html');
  });
  it('classifies text and json', () => {
    expect(classifyContentType('text/plain')).toBe('text');
    expect(classifyContentType('application/xml')).toBe('text');
    expect(classifyContentType('application/json')).toBe('json');
  });
  it('classifies unknown as binary', () => {
    expect(classifyContentType('application/pdf')).toBe('binary');
    expect(classifyContentType('image/png')).toBe('binary');
  });
});

describe('getFileExtension', () => {
  it('maps known content types', () => {
    expect(getFileExtension('text/html')).toBe('html');
    expect(getFileExtension('application/pdf')).toBe('pdf');
    expect(getFileExtension('image/jpeg')).toBe('jpg');
  });
  it('falls back to bin', () => {
    expect(getFileExtension('application/octet-stream')).toBe('bin');
  });
});

describe('convertHtml', () => {
  it('extracts main content and exposes metadata', async () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Doc Title</title>
      <meta name="author" content="Jane Roe">
      <meta name="description" content="A short summary.">
    </head><body>
      <nav><a href="/">Home</a></nav>
      <main><article>
        <h1>Doc Title</h1>
        <p>The main body content of the document goes here.</p>
        <h2>Section</h2>
        <p>More detail in this section worth keeping.</p>
      </article></main>
      <footer>Copyright</footer>
    </body></html>`;
    const { markdown, meta } = await convertHtml(
      html, 'https://example.com/doc',
    );
    // defuddle lifts the title into metadata rather than duplicating it as
    // an H1 in the body, so assert the title via meta and the body via content.
    expect(meta.title).toContain('Doc Title');
    expect(markdown).toContain('Section');
    expect(markdown).toContain('main body content');
    expect(markdown).not.toContain('Copyright');
  });
});
