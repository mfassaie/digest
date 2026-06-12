import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import { createArtefactStore } from '../store/store.js';
import { fetchFileArtefact, type PipelineDeps } from './fetch-file.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'digest-ff-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MD_URL = 'https://ex.com/docs/guide.md';

function respond(
  body: string, headers: Record<string, string> = {}, status = 200,
): typeof fetch {
  return async () => new Response(
    status === 304 ? null : body, { status, headers },
  );
}

function deps(fetchImpl: typeof fetch, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    store: createArtefactStore(root),
    settings: DEFAULT_SETTINGS,
    fetchImpl,
    ...extra,
  };
}

describe('fetchFileArtefact over http', () => {
  it('writes the file Digest and index entry for a fetched md url', async () => {
    const d = deps(respond('# Guide\n', {
      'content-type': 'text/markdown; charset=utf-8',
      etag: 'W/"v1"',
      'last-modified': 'Tue, 01 Jan 2026 00:00:00 GMT',
    }), { now: () => new Date('2026-06-13T10:00:00Z') });
    const out = await fetchFileArtefact(d, MD_URL);
    expect(out.kind).toBe('digest');
    if (out.kind !== 'digest') return;
    expect(out.source).toBe('network');
    expect(out.digest.type).toBe('file');
    expect(out.digest.origin_uri).toBe(MD_URL);
    expect(out.digest.file.name).toBe('guide.md');
    expect(out.digest.file.mime_type).toBe('text/markdown');
    expect(out.digest.file.hash).toMatch(/^sha256:/);
    // The host wrote the raw bytes into the artefact dir (ADR-009).
    const raw = await readFile(
      join(d.store.paths.artefactDir(out.digest.id), 'guide.md'), 'utf8',
    );
    expect(raw).toBe('# Guide\n');
    const entry = await d.store.readIndexEntry(out.digest.id);
    expect(entry?.origin_etag).toBe('W/"v1"');
    expect(entry?.last_modified).toBe('Tue, 01 Jan 2026 00:00:00 GMT');
    expect(entry?.last_fetched).toBe('2026-06-13T10:00:00.000Z');
  });

  it('executes a container-runtime http rule locally (M9 not yet wired)',
    async () => {
      // DEFAULT_SETTINGS route */* (and so .md urls) to runtime
      // 'container' with retrieval 'http' — raw bytes over plain http are
      // runtime-indifferent, so the local engine serves them until M9.
      const out = await fetchFileArtefact(deps(respond('x')), MD_URL);
      expect(out.kind).toBe('digest');
    });

  it('reports rules needing the stealth browser as browser-needed',
    async () => {
      const refuse: typeof fetch = async () => {
        throw new Error('must not fetch');
      };
      const out = await fetchFileArtefact(
        deps(refuse), 'https://ex.com/page',
      );
      // Extensionless → provisional text/html → default rule wants the
      // browser, which only exists in the container (lands in M9).
      expect(out).toEqual({ kind: 'browser-needed', mime: 'text/html' });
    });

  it('sends stored validators and serves from store on 304', async () => {
    const stamps = [
      new Date('2026-06-13T10:00:00Z'), new Date('2026-06-13T11:00:00Z'),
    ];
    const store = createArtefactStore(root, {
      now: () => stamps[0],
    });
    const first = await fetchFileArtefact({
      store, settings: DEFAULT_SETTINGS,
      fetchImpl: respond('# Guide\n', { etag: 'W/"v1"' }),
      now: () => stamps[0],
    }, MD_URL);
    expect(first.kind).toBe('digest');

    const seen: Headers[] = [];
    const notModified: typeof fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers as Record<string, string>));
      return new Response(null, { status: 304 });
    };
    const second = await fetchFileArtefact({
      store, settings: DEFAULT_SETTINGS, fetchImpl: notModified,
      now: () => stamps[1],
    }, MD_URL);
    expect(seen[0].get('if-none-match')).toBe('W/"v1"');
    expect(second.kind).toBe('digest');
    if (second.kind !== 'digest') return;
    expect(second.source).toBe('cache');
    const entry = await store.readIndexEntry(second.digest.id);
    expect(entry?.last_fetched).toBe('2026-06-13T11:00:00.000Z');
  });

  it('preserves relations across a re-fetch', async () => {
    const store = createArtefactStore(root);
    const d: PipelineDeps = {
      store, settings: DEFAULT_SETTINGS, fetchImpl: respond('v1'),
    };
    const first = await fetchFileArtefact(d, MD_URL);
    if (first.kind !== 'digest') throw new Error('expected digest');
    await store.updateDigest(first.digest.id, {
      mutate: (digest) => {
        digest.related = [{
          id: artefactId(MD_URL, 'document'), type: 'converted_to',
        }];
      },
    });
    const second = await fetchFileArtefact(
      { ...d, fetchImpl: respond('v2') }, MD_URL,
    );
    if (second.kind !== 'digest') throw new Error('expected digest');
    expect(second.digest.related).toEqual([{
      id: artefactId(MD_URL, 'document'), type: 'converted_to',
    }]);
  });

  it('errors when the origin replies 304 with nothing stored', async () => {
    const out = await fetchFileArtefact(
      deps(respond('', {}, 304)), MD_URL,
    );
    expect(out).toEqual({
      kind: 'error',
      reason: 'origin replied 304 but no stored artefact exists',
    });
  });

  it('passes cross-host redirects through', async () => {
    const out = await fetchFileArtefact(deps(async () => new Response(
      null,
      { status: 301, headers: { location: 'https://other.com/guide.md' } },
    )), MD_URL);
    expect(out).toEqual({
      kind: 'redirect',
      fromUrl: MD_URL,
      toUrl: 'https://other.com/guide.md',
    });
  });

  it('maps http errors, timeouts and failures to clean errors', async () => {
    expect(await fetchFileArtefact(deps(respond('', {}, 404)), MD_URL))
      .toEqual({ kind: 'error', reason: 'HTTP 404' });
    const failing: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await fetchFileArtefact(deps(failing), MD_URL))
      .toEqual({ kind: 'error', reason: 'fetch failed' });
  });

  it('reports the configured budget when a fetch times out', async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort', () => reject(init.signal!.reason),
        );
      });
    const settings = {
      ...DEFAULT_SETTINGS,
      fetch: { timeout_seconds: 1, retries: 0 },
    };
    const out = await fetchFileArtefact(
      deps(hang, { settings }), MD_URL,
    );
    expect(out).toEqual({ kind: 'error', reason: 'timed out after 1s' });
  }, 10_000);

  it('falls back to a mime-derived name when the path has none', async () => {
    // Route html to plain http so the extensionless url is fetchable.
    const settings = {
      ...DEFAULT_SETTINGS,
      types: {
        ...DEFAULT_SETTINGS.types,
        'text/html': {
          retrieval: 'http', parser: 'raw',
          runtime: 'local', escalate: 'none',
        } as const,
      },
    };
    const out = await fetchFileArtefact(deps(respond('# x', {
      'content-type': 'text/markdown',
    }), { settings }), 'https://ex.com/');
    if (out.kind !== 'digest') throw new Error('expected digest');
    expect(out.digest.file.name).toBe('download.md');
    // The authoritative Content-Type wins over the provisional html guess.
    expect(out.digest.file.mime_type).toBe('text/markdown');
  });

  it('rejects an invalid resource', async () => {
    const out = await fetchFileArtefact(deps(respond('')), 'mailto:a@b.c');
    expect(out.kind).toBe('error');
  });
});

describe('fetchFileArtefact over the filesystem', () => {
  it('stores a local path read as a file Digest', async () => {
    const path = join(root, 'notes.md');
    await writeFile(path, '# Local\n', 'utf8');
    const out = await fetchFileArtefact(
      deps(async () => { throw new Error('no network'); }), path,
    );
    expect(out.kind).toBe('digest');
    if (out.kind !== 'digest') return;
    expect(out.source).toBe('file');
    expect(out.digest.origin_uri).toBe(pathToFileURL(path).href);
    expect(out.digest.file.mime_type).toBe('text/markdown');
  });

  it('derives the same artefact for file:// and plain-path spellings',
    async () => {
      const path = join(root, 'same.md');
      await writeFile(path, 'x', 'utf8');
      const d = deps(async () => { throw new Error('no network'); });
      const a = await fetchFileArtefact(d, path);
      const b = await fetchFileArtefact(d, pathToFileURL(path).href);
      if (a.kind !== 'digest' || b.kind !== 'digest') {
        throw new Error('expected digests');
      }
      expect(a.digest.id).toBe(b.digest.id);
    });

  it('errors cleanly on a missing local file', async () => {
    const out = await fetchFileArtefact(
      deps(async () => { throw new Error('no network'); }),
      join(root, 'gone.md'),
    );
    expect(out.kind).toBe('error');
    expect((out as { reason: string }).reason)
      .toContain('cannot read local file');
  });

  it('writes pipeline events to the per-document jsonl log', async () => {
    const path = join(root, 'logged.md');
    await writeFile(path, 'x', 'utf8');
    const logsDir = join(root, 'logs');
    const out = await fetchFileArtefact(
      deps(async () => { throw new Error('no network'); }, { logsDir }),
      path,
    );
    if (out.kind !== 'digest') throw new Error('expected digest');
    const log = await readFile(
      join(logsDir, 'docs', out.digest.id, 'pipeline.jsonl'), 'utf8',
    );
    const events = log.trim().split('\n').map(
      (line) => (JSON.parse(line) as { event: string }).event,
    );
    expect(events).toEqual(['fetch_file', 'stored']);
  });
});
