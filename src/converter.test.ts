import { describe, it, expect, vi } from 'vitest';
import {
  classifyContentType,
  getFileExtension,
  processContent,
} from './converter.js';

vi.mock('defuddle/node', () => ({
  Defuddle: vi.fn().mockResolvedValue({
    content: '# Extracted Content\n\nMain body text.',
    title: 'Test Page',
  }),
}));

vi.mock('linkedom', () => ({
  parseHTML: vi.fn().mockReturnValue({
    document: {},
  }),
}));

describe('classifyContentType', () => {
  it('classifies text/html as html', () => {
    expect(classifyContentType('text/html')).toBe('html');
  });

  it('classifies application/xhtml+xml as html', () => {
    expect(classifyContentType('application/xhtml+xml'))
      .toBe('html');
  });

  it('classifies text/plain as text', () => {
    expect(classifyContentType('text/plain')).toBe('text');
  });

  it('classifies text/markdown as text', () => {
    expect(classifyContentType('text/markdown')).toBe('text');
  });

  it('classifies text/xml as text', () => {
    expect(classifyContentType('text/xml')).toBe('text');
  });

  it('classifies application/xml as text', () => {
    expect(classifyContentType('application/xml')).toBe('text');
  });

  it('classifies application/json as json', () => {
    expect(classifyContentType('application/json')).toBe('json');
  });

  it('classifies application/pdf as binary', () => {
    expect(classifyContentType('application/pdf')).toBe('binary');
  });

  it('classifies image/png as binary', () => {
    expect(classifyContentType('image/png')).toBe('binary');
  });

  it('classifies unknown type as binary', () => {
    expect(classifyContentType('application/octet-stream'))
      .toBe('binary');
  });

  it('handles charset parameter', () => {
    expect(classifyContentType('text/html; charset=utf-8'))
      .toBe('html');
  });
});

describe('getFileExtension', () => {
  it('returns html for text/html', () => {
    expect(getFileExtension('text/html')).toBe('html');
  });

  it('returns json for application/json', () => {
    expect(getFileExtension('application/json')).toBe('json');
  });

  it('returns pdf for application/pdf', () => {
    expect(getFileExtension('application/pdf')).toBe('pdf');
  });

  it('returns bin for unknown types', () => {
    expect(getFileExtension('application/octet-stream'))
      .toBe('bin');
  });
});

describe('processContent', () => {
  it('HTML: returns raw and markdown', async () => {
    const body = Buffer.from(
      '<html><body><p>hello</p></body></html>'
    );
    const result = await processContent(
      body, 'text/html', 'https://example.com'
    );
    expect(result.ext).toBe('html');
    expect(result.markdown).toBeDefined();
    expect(result.raw).toEqual(body);
  });

  it('JSON: returns pretty-printed raw, no markdown', async () => {
    const body = Buffer.from('{"a":1,"b":2}');
    const result = await processContent(
      body, 'application/json', 'https://example.com'
    );
    expect(result.ext).toBe('json');
    expect(result.markdown).toBeUndefined();
    expect(result.raw.toString()).toBe(
      '{\n  "a": 1,\n  "b": 2\n}'
    );
  });

  it('text: returns raw as-is, no markdown', async () => {
    const body = Buffer.from('plain text content');
    const result = await processContent(
      body, 'text/plain', 'https://example.com'
    );
    expect(result.ext).toBe('txt');
    expect(result.markdown).toBeUndefined();
    expect(result.raw).toEqual(body);
  });

  it('binary: returns raw as-is, no markdown', async () => {
    const body = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const result = await processContent(
      body, 'application/pdf', 'https://example.com'
    );
    expect(result.ext).toBe('pdf');
    expect(result.markdown).toBeUndefined();
    expect(result.raw).toEqual(body);
  });
});
