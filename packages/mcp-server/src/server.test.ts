import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGet, handleRead, type ServerDeps } from './server.js';
import {
  getCachePath, extractiveEngine, DockerUnavailableError,
  type ContainerFetchResponse, type ContainerTransport, type Section,
} from '@digest/shared';

let cacheRoot: string;
beforeEach(() => { cacheRoot = mkdtempSync(join(tmpdir(), 'falk-srv-')); });
afterEach(() => { rmSync(cacheRoot, { recursive: true, force: true }); });

function deps(
  res: ContainerFetchResponse,
  transport: Partial<ContainerTransport> = {},
): ServerDeps {
  return {
    transport: {
      ensure: async () => ({ baseUrl: 'http://stub' }),
      fetch: async () => res,
      ...transport,
    },
    cacheRoot,
    engine: extractiveEngine,
  };
}

const sections: Section[] = [
  { level: 1, title: 'Title', slug: 'title', startLine: 1, endLine: 3 },
  { level: 2, title: 'Install', slug: 'install', startLine: 4, endLine: 6 },
];

// Seed a cache dir as the container would, plus host meta.json.
async function seedCache(url: string): Promise<void> {
  const dir = join(cacheRoot, getCachePath(url));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'content.md'),
    '# Title\nIntro.\n\n## Install\nRun it.\n', 'utf8');
  await writeFile(join(dir, 'structure.json'),
    JSON.stringify(sections), 'utf8');
  await writeFile(join(dir, 'raw.html'), '<html></html>', 'utf8');
  await writeFile(join(dir, 'meta.json'), JSON.stringify({
    cacheVersion: 2, url, finalUrl: url, contentType: 'text/html',
    category: 'html', converter: 'defuddle', fetchedAt: 'now',
    title: 'Title', description: 'A doc.',
    rawFile: 'raw.html', markdownFile: 'content.md',
    structureFile: 'structure.json',
  }), 'utf8');
}

const fetched: ContainerFetchResponse = {
  outcome: 'fetched', status: 200, finalUrl: 'https://ex.com/p',
  contentType: 'text/html', category: 'html',
  etag: 'W/"x"',
  meta: { title: 'Doc Title', description: 'Desc', wordCount: 100 },
  sections,
  content: {
    ext: 'html',
    raw: Buffer.from('<html><body>hi</body></html>', 'utf8').toString('base64'),
    markdown: '# Title\nIntro.\n\n## Install\nRun it.\n',
  },
};

describe('handleGet', () => {
  it('returns metadata, paths and outline on fetch, writes meta', async () => {
    const out = await handleGet(
      { uri: 'https://ex.com/p' }, deps(fetched),
    );
    expect(out.isError).toBeUndefined();
    const t = out.content[0].text;
    expect(t).toContain('Doc Title');
    expect(t).toContain('Sections (2)');
    expect(t).toContain('[install]');
    expect(t).toContain('content.md');
    // meta.json is written by the host so a later read/get finds the entry
    // (content.md itself is written by the container, stubbed out here).
    const dir = join(cacheRoot, getCachePath('https://ex.com/p'));
    const { readFile } = await import('node:fs/promises');
    const written = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
    expect(written.etag).toBe('W/"x"');
    expect(written.markdownFile).toBe('content.md');
  });

  it('upgrades http to https before fetching', async () => {
    let seen = '';
    const d = deps(fetched, {
      fetch: async (_b, req) => { seen = req.url; return fetched; },
    });
    await handleGet({ uri: 'http://ex.com/p' }, d);
    expect(seen).toBe('https://ex.com/p');
  });

  it('reports cross-host redirects', async () => {
    const out = await handleGet({ uri: 'https://ex.com/p' }, deps({
      outcome: 'cross-host-redirect',
      fromUrl: 'https://ex.com/p', toUrl: 'https://other.com/p',
    }));
    expect(out.content[0].text).toContain('Redirect detected');
  });

  it('returns isError on http-error', async () => {
    const out = await handleGet({ uri: 'https://ex.com/p' }, deps({
      outcome: 'http-error', status: 404,
    }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('HTTP 404');
  });

  it('returns isError on timeout', async () => {
    const out = await handleGet({ uri: 'https://ex.com/p' }, deps({
      outcome: 'timeout',
    }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Timeout');
  });

  it('serves cached files on not-modified', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleGet({ uri: 'https://ex.com/p' }, deps({
      outcome: 'not-modified',
    }));
    expect(out.content[0].text).toContain('cache (validated)');
    expect(out.content[0].text).toContain('Sections (2)');
  });

  it('errors on not-modified with no cache entry', async () => {
    const out = await handleGet({ uri: 'https://ex.com/empty' }, deps({
      outcome: 'not-modified',
    }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('cache validated but no entry');
  });

  it('returns isError on an invalid url', async () => {
    const out = await handleGet({ uri: 'not a url' }, deps(fetched));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Invalid URL');
  });

  it('returns isError on fetch-failed with the reason', async () => {
    const out = await handleGet({ uri: 'https://ex.com/p' }, deps({
      outcome: 'fetch-failed', reason: 'connection reset',
    }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('connection reset');
  });

  it('renders DockerUnavailableError from the transport as a tool error', async () => {
    const d = deps(fetched, {
      ensure: async () => {
        throw new DockerUnavailableError('Docker is not available.');
      },
    });
    const out = await handleGet({ uri: 'https://ex.com/p' }, d);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Docker is not available.');
  });

  it('rethrows unexpected transport errors', async () => {
    const d = deps(fetched, {
      ensure: async () => { throw new Error('boom'); },
    });
    await expect(handleGet({ uri: 'https://ex.com/p' }, d))
      .rejects.toThrow('boom');
  });
});

describe('handleRead', () => {
  it('errors when nothing cached', async () => {
    const out = await handleRead({ uri: 'https://ex.com/none' }, deps(fetched));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('fetch first');
  });

  it('returns the section outline by default', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead({ uri: 'https://ex.com/p' }, deps(fetched));
    expect(out.content[0].text).toContain('Sections (2)');
    expect(out.content[0].text).toContain('[install]');
  });

  it('returns one section by slug', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'sections', section: 'install' },
      deps(fetched),
    );
    expect(out.content[0].text).toContain('## Install');
    expect(out.content[0].text).toContain('Run it.');
    expect(out.content[0].text).not.toContain('Intro.');
  });

  it('errors with outline for unknown section', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'sections', section: 'nope' },
      deps(fetched),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('[install]');
  });

  it('returns keywords', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'keywords' }, deps(fetched),
    );
    expect(out.content[0].text.length).toBeGreaterThan(0);
  });

  it('returns full markdown', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'full' }, deps(fetched),
    );
    expect(out.content[0].text).toContain('# Title');
    expect(out.content[0].text).toContain('## Install');
  });

  it('returns isError on an invalid url', async () => {
    const out = await handleRead({ uri: 'not a url' }, deps(fetched));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Invalid URL');
  });

  it('returns a summary prefixed with the cached description', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'summary' }, deps(fetched),
    );
    expect(out.isError).toBeUndefined();
    expect(out.content[0].text).toContain('A doc.');
  });

  it('points at the raw file for non-HTML cache entries', async () => {
    const url = 'https://ex.com/file.pdf';
    const dir = join(cacheRoot, getCachePath(url));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'raw.pdf'), '%PDF', 'utf8');
    await writeFile(join(dir, 'meta.json'), JSON.stringify({
      cacheVersion: 2, url, finalUrl: url,
      contentType: 'application/pdf', category: 'binary',
      converter: 'defuddle', fetchedAt: 'now', rawFile: 'raw.pdf',
    }), 'utf8');
    const out = await handleRead({ uri: url }, deps(fetched));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('non-HTML/raw file');
    expect(out.content[0].text).toContain('raw.pdf');
  });

  it('errors when the cached markdown file is missing', async () => {
    const url = 'https://ex.com/gone';
    const dir = join(cacheRoot, getCachePath(url));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify({
      cacheVersion: 2, url, finalUrl: url,
      contentType: 'text/html', category: 'html', converter: 'defuddle',
      fetchedAt: 'now', rawFile: 'raw.html', markdownFile: 'content.md',
    }), 'utf8');
    const out = await handleRead({ uri: url }, deps(fetched));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('cached markdown missing');
  });

  it('errors on an unknown mode', async () => {
    await seedCache('https://ex.com/p');
    const out = await handleRead(
      { uri: 'https://ex.com/p', mode: 'bogus' }, deps(fetched),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('unknown mode: bogus');
  });
});
