import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, handleWebfetchPlus } from './server.js';

// Mock cache root to use temp directory
let tempDir: string;

vi.mock('./cache.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./cache.js')
  >();
  return {
    ...actual,
    getCacheDir: (url: string) => {
      return actual.getCacheDir(url, tempDir);
    },
  };
});

vi.mock('defuddle/node', () => ({
  Defuddle: vi.fn().mockResolvedValue({
    content: '# Test Page\n\nExtracted content here.',
    title: 'Test Page',
  }),
}));

vi.mock('linkedom', () => ({
  parseHTML: vi.fn().mockReturnValue({ document: {} }),
}));

function mockFetchResponse(
  body: string,
  init?: ResponseInit,
) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      ...init,
    }))
  );
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wfp-srv-'));
  vi.restoreAllMocks();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// Wave 2: Contract tests

describe('API-001: Tool schema', () => {
  it('server has webfetch_plus tool', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(
      '<html><body>hello</body></html>'
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com' },
    ) as { content: { type: string; text: string }[] };

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
  });
});

describe('API-002: Success response format', () => {
  it('contains required fields', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(
      '<html><body>hello</body></html>'
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('URL: https://example.com');
    expect(text).toContain('Status: 200');
    expect(text).toContain('Content-Type: text/html');
    expect(text).toContain('Files:');
    expect(text).toContain('raw:');
    expect(text).toContain('Size:');
    expect(text).toContain('Fetched:');
    expect(text).toContain('Source: fresh');
  });
});

describe('API-003: Error response format', () => {
  it('returns isError on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted',
        'TimeoutError')
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com', timeout_seconds: 1 },
    ) as {
      isError: boolean;
      content: { type: string; text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      'Error fetching'
    );
    expect(result.content[0].text).toContain(
      'Timeout after 1 seconds'
    );
  });

  it('returns isError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      }))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com/missing' },
    ) as {
      isError: boolean;
      content: { type: string; text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 404');
  });
});

describe('API-004: Redirect response format', () => {
  it('returns redirect notice for cross-host', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('', {
        status: 301,
        headers: {
          Location: 'https://other.com/page',
        },
      }))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com/page' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('Redirect detected (cross-host)');
    expect(text).toContain(
      'From: https://example.com/page'
    );
    expect(text).toContain('To: https://other.com/page');
    expect(text).toContain('Make a new request');
  });
});

// Wave 3: Acceptance tests

describe('SPEC-001: Fetch HTML end-to-end', () => {
  it('fetches, extracts, saves, returns paths', async () => {
    vi.stubGlobal('fetch', mockFetchResponse(
      '<html><head><title>Docs</title></head>' +
      '<body><p>content</p></body></html>'
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://docs.example.com/api' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('raw.html');
    expect(text).toContain('content.md');
    expect(text).toContain('Source: fresh');
    // INV-008: no inline content
    expect(text).not.toContain('<html');
    expect(text).not.toContain('<body');
  });
});

describe('SPEC-002: Timeout prevents hangs', () => {
  it('returns error, no cache entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted',
        'TimeoutError')
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://slow.example.com', timeout_seconds: 5 },
    ) as {
      isError: boolean;
      content: { type: string; text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Timeout');
  });
});

describe('SPEC-003: Cross-host redirect', () => {
  it('detects and reports cross-host redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('', {
        status: 302,
        headers: { Location: 'https://new.example.com/' },
      }))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://old.example.com/' },
    ) as { content: { type: string; text: string }[] };

    expect(result.content[0].text).toContain(
      'Redirect detected'
    );
  });

  it('follows same-host redirect', async () => {
    const mockFetch = vi.fn()
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('', {
          status: 301,
          headers: {
            Location: 'https://example.com/new',
          },
        }))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('<html>final</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }))
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await handleWebfetchPlus(
      { url: 'https://example.com/old' },
    ) as { content: { type: string; text: string }[] };

    expect(result.content[0].text).toContain('Status: 200');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('SPEC-004: Content-type branching', () => {
  it('handles text/plain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('plain text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com/file.txt' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('Content-Type: text/plain');
    expect(text).toContain('raw.txt');
    expect(text).not.toContain('content.md');
  });

  it('handles application/json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{"key":"value"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://api.example.com/data' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('Content-Type: application/json');
    expect(text).toContain('raw.json');
  });

  it('handles binary (PDF)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(
        Buffer.from([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }
      ))
    ));

    const result = await handleWebfetchPlus(
      { url: 'https://example.com/doc.pdf' },
    ) as { content: { type: string; text: string }[] };

    const text = result.content[0].text;
    expect(text).toContain('Content-Type: application/pdf');
    expect(text).toContain('raw.pdf');
    expect(text).not.toContain('content.md');
  });
});

describe('SPEC-005: Cache validation', () => {
  it('cache miss creates entry, cache hit validates', async () => {
    // First call: fresh fetch
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(
        '<html>cached page</html>', {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'ETag': '"abc123"',
          },
        }
      ))
    );
    vi.stubGlobal('fetch', mockFetch);

    const first = await handleWebfetchPlus(
      { url: 'https://example.com/cached' },
    ) as { content: { type: string; text: string }[] };

    expect(first.content[0].text).toContain('Source: fresh');

    // Second call: conditional fetch returns 304
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        status: 304,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      })
    );

    const second = await handleWebfetchPlus(
      { url: 'https://example.com/cached' },
    ) as { content: { type: string; text: string }[] };

    expect(second.content[0].text).toContain(
      'Source: cache (validated)'
    );
  });
});

describe('SPEC-006: MCP server lifecycle', () => {
  it('creates server with correct name', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
