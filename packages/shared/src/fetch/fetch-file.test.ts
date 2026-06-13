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
    const revalidated = new Promise<void>((resolve) => {
      const notModified: typeof fetch = async (_input, init) => {
        seen.push(new Headers(init?.headers as Record<string, string>));
        // Signal completion after a microtask so the store update runs.
        queueMicrotask(resolve);
        return new Response(null, { status: 304 });
      };
      // Second call is stale (no fresh_until): returns from cache
      // synchronously and fires background revalidation with validators.
      fetchFileArtefact({
        store, settings: DEFAULT_SETTINGS, fetchImpl: notModified,
        now: () => stamps[1],
      }, MD_URL).then((second) => {
        expect(second.kind).toBe('digest');
        if (second.kind === 'digest') {
          expect(second.source).toBe('cache');
        }
      });
    });
    await revalidated;
    // Allow the background store update to complete.
    await new Promise((r) => setTimeout(r, 50));
    expect(seen[0].get('if-none-match')).toBe('W/"v1"');
    if (first.kind !== 'digest') return;
    const entry = await store.readIndexEntry(first.digest.id);
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

describe('SWR freshness (plan M7)', () => {
  it('returns from cache without network when entry is fresh', async () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const store = createArtefactStore(root, { now: () => now });
    // Seed a file Digest with a fresh_until in the future.
    await store.createDigest({
      originUri: MD_URL, type: 'file',
      file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# A\n' },
      index: {
        last_fetched: now.toISOString(),
        fresh_until: '2026-06-13T12:00:00.000Z',
      },
    });
    const mustNotFetch: typeof fetch = async () => {
      throw new Error('network must not be touched for a fresh entry');
    };
    const out = await fetchFileArtefact({
      store, settings: DEFAULT_SETTINGS, fetchImpl: mustNotFetch,
      now: () => now,
    }, MD_URL);
    expect(out.kind).toBe('digest');
    if (out.kind !== 'digest') return;
    expect(out.source).toBe('cache');
    expect(out.digest.file.name).toBe('guide.md');
  });

  it('returns stale cache immediately and fires background revalidation',
    async () => {
      const t0 = new Date('2026-06-13T08:00:00Z');
      const t1 = new Date('2026-06-13T11:00:00Z');
      const store = createArtefactStore(root, { now: () => t0 });
      // Seed with a stale entry (fresh_until in the past relative to t1).
      await store.createDigest({
        originUri: MD_URL, type: 'file',
        file: {
          name: 'guide.md', mimeType: 'text/markdown', bytes: '# Old\n',
        },
        index: {
          last_fetched: t0.toISOString(),
          fresh_until: '2026-06-13T09:00:00.000Z',
          origin_etag: 'W/"old"',
        },
      });
      let revalidateCalled = false;
      const revalidated = new Promise<void>((resolve) => {
        const bg: typeof fetch = async () => {
          revalidateCalled = true;
          resolve();
          return new Response('# New\n', {
            status: 200,
            headers: {
              'content-type': 'text/markdown',
              etag: 'W/"new"',
              'cache-control': 'max-age=7200',
            },
          });
        };
        // Synchronous return should be from cache.
        fetchFileArtefact({
          store, settings: DEFAULT_SETTINGS, fetchImpl: bg,
          now: () => t1,
        }, MD_URL).then((out) => {
          expect(out.kind).toBe('digest');
          if (out.kind === 'digest') {
            expect(out.source).toBe('cache');
          }
        });
      });
      await revalidated;
      // Let the background store write complete.
      await new Promise((r) => setTimeout(r, 100));
      expect(revalidateCalled).toBe(true);
      // The background revalidation should have updated the stored Digest.
      const id = artefactId(MD_URL, 'file');
      const updated = await store.readDigest(id);
      expect(updated?.file.hash).not.toBe(
        'sha256:' + 'a'.repeat(64),
      );
      const entry = await store.readIndexEntry(id);
      expect(entry?.origin_etag).toBe('W/"new"');
      expect(entry?.fresh_until).toBeDefined();
    });

  it('goes to synchronous fetch on a miss (no stored entry)', async () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const out = await fetchFileArtefact({
      store: createArtefactStore(root, { now: () => now }),
      settings: DEFAULT_SETTINGS,
      fetchImpl: respond('# Fresh\n', {
        'content-type': 'text/markdown',
        'cache-control': 'max-age=3600',
      }),
      now: () => now,
    }, MD_URL);
    expect(out.kind).toBe('digest');
    if (out.kind !== 'digest') return;
    expect(out.source).toBe('network');
    // The synchronous fetch should compute fresh_until from cache-control.
    const id = artefactId(MD_URL, 'file');
    const entry = await (createArtefactStore(root)).readIndexEntry(id);
    expect(entry?.fresh_until).toBe('2026-06-13T11:00:00.000Z');
  });

  it('abort-bounds background revalidation on timeout', async () => {
    const t0 = new Date('2026-06-13T08:00:00Z');
    const t1 = new Date('2026-06-13T11:00:00Z');
    const store = createArtefactStore(root, { now: () => t0 });
    await store.createDigest({
      originUri: MD_URL, type: 'file',
      file: {
        name: 'guide.md', mimeType: 'text/markdown', bytes: '# Old\n',
      },
      index: {
        last_fetched: t0.toISOString(),
        fresh_until: '2026-06-13T09:00:00.000Z',
      },
    });
    let aborted = false;
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const settings = {
      ...DEFAULT_SETTINGS,
      fetch: { timeout_seconds: 1, retries: 0 },
    };
    const out = await fetchFileArtefact({
      store, settings, fetchImpl: hang,
      now: () => t1,
    }, MD_URL);
    // Synchronous return from cache should be immediate.
    expect(out.kind).toBe('digest');
    if (out.kind === 'digest') expect(out.source).toBe('cache');
    // Wait for the abort timer to fire (1s budget).
    await new Promise((r) => setTimeout(r, 1200));
    expect(aborted).toBe(true);
  }, 10_000);

  it('computes fresh_until from response cache-control headers', async () => {
    const now = new Date('2026-06-13T10:00:00Z');
    const out = await fetchFileArtefact(deps(respond('data', {
      'content-type': 'text/markdown',
      'cache-control': 'max-age=1800',
    }), { now: () => now }), MD_URL);
    if (out.kind !== 'digest') throw new Error('expected digest');
    // Read from the same root that deps() wrote to.
    const store2 = createArtefactStore(root);
    const entry2 = await store2.readIndexEntry(out.digest.id);
    expect(entry2?.fresh_until).toBeDefined();
    // Allow a small timing drift from http-cache-semantics using real
    // Date.now() internally (typically <10ms).
    const expected = new Date('2026-06-13T10:30:00.000Z').getTime();
    const actual = new Date(entry2!.fresh_until!).getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(1000);
  });
});
