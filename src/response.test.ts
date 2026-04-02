import { describe, it, expect } from 'vitest';
import {
  formatSuccess,
  formatError,
  formatRedirect,
} from './response.js';

describe('formatSuccess', () => {
  const base = {
    url: 'https://example.com/docs',
    status: 200,
    contentType: 'text/html',
    rawFile: '/cache/example.com/abc/raw.html',
    rawSize: 131788,
    fetchedAt: '2026-04-02T14:30:00Z',
    source: 'fresh' as const,
  };

  it('contains URL, Status, Content-Type', () => {
    const result = formatSuccess(base);
    expect(result).toContain('URL: https://example.com/docs');
    expect(result).toContain('Status: 200');
    expect(result).toContain('Content-Type: text/html');
  });

  it('contains raw file path', () => {
    const result = formatSuccess(base);
    expect(result).toContain(
      'raw: /cache/example.com/abc/raw.html'
    );
  });

  it('contains markdown file path when present', () => {
    const result = formatSuccess({
      ...base,
      markdownFile: '/cache/example.com/abc/content.md',
      markdownSize: 46285,
    });
    expect(result).toContain(
      'markdown: /cache/example.com/abc/content.md'
    );
  });

  it('omits markdown line when no markdown file', () => {
    const result = formatSuccess(base);
    expect(result).not.toContain('markdown:');
  });

  it('contains file sizes', () => {
    const result = formatSuccess(base);
    expect(result).toContain('128.7 KB (raw)');
  });

  it('contains Fetched timestamp', () => {
    const result = formatSuccess(base);
    expect(result).toContain('Fetched: 2026-04-02T14:30:00Z');
  });

  it('contains Source indicator', () => {
    const result = formatSuccess(base);
    expect(result).toContain('Source: fresh');
  });

  it('contains Title when provided', () => {
    const result = formatSuccess({
      ...base, title: 'API Docs',
    });
    expect(result).toContain('Title: API Docs');
  });

  it('omits Title when not provided', () => {
    const result = formatSuccess(base);
    expect(result).not.toContain('Title:');
  });

  it('never contains HTML or markdown content', () => {
    const result = formatSuccess({
      ...base,
      markdownFile: '/cache/content.md',
      markdownSize: 100,
    });
    expect(result).not.toContain('<html');
    expect(result).not.toContain('<body');
    expect(result).not.toContain('# ');
  });
});

describe('formatError', () => {
  it('contains URL and reason', () => {
    const result = formatError(
      'https://example.com', 'Timeout after 30 seconds'
    );
    expect(result).toContain(
      'Error fetching https://example.com'
    );
    expect(result).toContain(
      'Reason: Timeout after 30 seconds'
    );
  });

  it('formats HTTP errors', () => {
    const result = formatError(
      'https://example.com', 'HTTP 404 Not Found'
    );
    expect(result).toContain('Reason: HTTP 404 Not Found');
  });
});

describe('formatRedirect', () => {
  it('contains From and To URLs', () => {
    const result = formatRedirect(
      'https://old.example.com/docs',
      'https://new.example.com/docs',
    );
    expect(result).toContain(
      'From: https://old.example.com/docs'
    );
    expect(result).toContain(
      'To: https://new.example.com/docs'
    );
  });

  it('contains instruction to make new request', () => {
    const result = formatRedirect(
      'https://a.com', 'https://b.com'
    );
    expect(result).toContain('Make a new request');
  });
});
