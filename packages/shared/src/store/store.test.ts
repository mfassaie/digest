import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from './hash.js';
import { artefactId, mintGuid } from './ids.js';
import type { DigestDocument } from './record.js';
import {
  createArtefactStore, safeFileName, type ArtefactStore,
} from './store.js';

const URI = 'https://docs.foo.dev/guide.md';
const T0 = '2026-06-13T10:00:00.000Z';

// Injected fake clock: each call advances one second from T0.
function makeClock(): () => Date {
  let t = Date.parse(T0) - 1000;
  return () => new Date((t += 1000));
}

function docBranch(): DigestDocument {
  return {
    name: 'Guide',
    summary: 'A guide.',
    keywords: ['guide'],
    writable: 'full',
    source_file_hash: hashBytes('raw'),
    sections: {
      id: mintGuid(),
      type: 'root',
      depth: 0,
      index: 0,
      hash: hashBytes('root'),
      created_at: T0,
      content: [{
        id: mintGuid(),
        index: 0,
        type: 'paragraph',
        value: 'Hello.',
        hash: hashBytes('hello'),
        created_at: T0,
      }],
    },
  };
}

let root: string;
let store: ArtefactStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'falk-store-'));
  store = createArtefactStore(root, { now: makeClock() });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function createFile(): Promise<string> {
  const digest = await store.createDigest({
    originUri: URI,
    type: 'file',
    file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# Guide\n' },
    index: { origin_etag: 'W/"abc"' },
  });
  return digest.id;
}

describe('createDigest', () => {
  it('lays out the artefact dir: raw file, chunks/, digest.json', async () => {
    const id = await createFile();
    const dir = store.paths.artefactDir(id);
    expect(existsSync(join(dir, 'guide.md'))).toBe(true);
    expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe('# Guide\n');
    expect(existsSync(store.paths.chunksDir(id))).toBe(true);
    expect(existsSync(store.paths.digestPath(id))).toBe(true);
  });

  it('derives the deterministic id and fills the file branch', async () => {
    const digest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# G\n' },
    });
    expect(digest.id).toBe(artefactId(URI, 'file'));
    expect(digest.type).toBe('file');
    expect(digest.origin_uri).toBe(URI);
    expect(digest.created_at).toBe(T0);
    expect(digest.updated_at).toBeUndefined();
    expect(digest.file.name).toBe('guide.md');
    expect(digest.file.uri.startsWith('file://')).toBe(true);
    expect(fileURLToPath(digest.file.uri))
      .toBe(join(store.paths.artefactDir(digest.id), 'guide.md'));
    expect(digest.file.hash).toBe(hashBytes('# G\n'));
    expect(digest.file.size_bytes).toBe(4);
  });

  it('upserts the index entry with web cache fields', async () => {
    const id = await createFile();
    const entry = await store.readIndexEntry(id);
    expect(entry).toEqual({
      artefact_id: id,
      artefact_type: 'file',
      origin_uri: URI,
      origin_etag: 'W/"abc"',
      created_at: T0,
    });
  });

  it('persists document branch and relations on document artefacts',
    async () => {
      const fileId = artefactId(URI, 'file');
      const digest = await store.createDigest({
        originUri: URI,
        type: 'document',
        file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# G' },
        document: docBranch(),
        related: [{ id: fileId, type: 'converted_from' }],
      });
      expect(digest.document?.name).toBe('Guide');
      expect(digest.related).toEqual([
        { id: fileId, type: 'converted_from' },
      ]);
      const entry = await store.readIndexEntry(digest.id);
      expect(entry?.artefact_type).toBe('document');
      expect(entry?.origin_etag).toBeUndefined();
    });

  it('rejects a document branch on file artefacts', async () => {
    await expect(store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'g.md', mimeType: 'text/markdown', bytes: 'x' },
      document: docBranch(),
    })).rejects.toThrow(/invalid digest record/);
  });

  it('rejects document artefacts without the document branch', async () => {
    await expect(store.createDigest({
      originUri: URI,
      type: 'document',
      file: { name: 'g.md', mimeType: 'text/markdown', bytes: 'x' },
    })).rejects.toThrow(/invalid digest record/);
  });

  it('rejects web cache fields on document index entries', async () => {
    await expect(store.createDigest({
      originUri: URI,
      type: 'document',
      file: { name: 'g.md', mimeType: 'text/markdown', bytes: 'x' },
      document: docBranch(),
      index: { origin_etag: 'W/"abc"' },
    })).rejects.toThrow(/invalid index entry/);
  });

  it('re-creating keeps created_at, stamps updated_at, resets content',
    async () => {
      const id = await createFile();
      await store.writeChunk(id, {
        index: 0, name: 'part-0.md', bytes: 'p0', chunkMeta: 'sections 1-2',
      });
      const again = await store.createDigest({
        originUri: URI,
        type: 'file',
        file: { name: 'renamed.md', mimeType: 'text/markdown', bytes: 'v2' },
      });
      expect(again.id).toBe(id);
      expect(again.created_at).toBe(T0);
      expect(again.updated_at).toBeDefined();
      expect(again.file.chunks).toBeUndefined();
      const dir = store.paths.artefactDir(id);
      expect(existsSync(join(dir, 'guide.md'))).toBe(false);
      expect(readFileSync(join(dir, 'renamed.md'), 'utf8')).toBe('v2');
      expect(readdirSync(store.paths.chunksDir(id))).toEqual([]);
      const entry = await store.readIndexEntry(id);
      expect(entry?.created_at).toBe(T0);
      expect(entry?.updated_at).toBeDefined();
    });

  it('recovers by overwriting a corrupt previous digest.json', async () => {
    const id = await createFile();
    writeFileSync(store.paths.digestPath(id), 'not json');
    const digest = await store.createDigest({
      originUri: URI,
      type: 'file',
      file: { name: 'guide.md', mimeType: 'text/markdown', bytes: 'ok' },
    });
    expect(digest.file.hash).toBe(hashBytes('ok'));
  });
});

describe('readDigest', () => {
  it('round-trips what createDigest wrote', async () => {
    const fileId = artefactId(URI, 'file');
    const created = await store.createDigest({
      originUri: URI,
      type: 'document',
      file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# G' },
      document: docBranch(),
      related: [{ id: fileId, type: 'converted_from' }],
    });
    expect(await store.readDigest(created.id)).toEqual(created);
  });

  it('returns null for unknown artefacts', async () => {
    expect(await store.readDigest(mintGuid())).toBeNull();
  });

  it('throws on malformed ids (path safety)', async () => {
    await expect(store.readDigest('../escape')).rejects
      .toThrow(/invalid artefact id/);
  });

  it('throws a clear error on corrupt digest.json', async () => {
    const id = await createFile();
    writeFileSync(store.paths.digestPath(id), '{not json');
    await expect(store.readDigest(id)).rejects.toThrow(/corrupt digest/);
  });

  it('throws a clear error on schema-invalid digest.json', async () => {
    const id = await createFile();
    writeFileSync(store.paths.digestPath(id), '{"id": "nope"}');
    await expect(store.readDigest(id)).rejects
      .toThrow(/invalid digest record/);
  });
});

describe('updateDigest', () => {
  it('mutates the record, keeping created_at and stamping updated_at',
    async () => {
      const fileId = artefactId(URI, 'file');
      const created = await store.createDigest({
        originUri: URI,
        type: 'document',
        file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '# G' },
        document: docBranch(),
        related: [{ id: fileId, type: 'converted_from' }],
      });
      const updated = await store.updateDigest(created.id, {
        mutate: (d) => {
          d.document!.summary = 'New summary.';
        },
      });
      expect(updated.document?.summary).toBe('New summary.');
      expect(updated.created_at).toBe(created.created_at);
      expect(updated.updated_at).toBeDefined();
      expect(updated.updated_at! > created.created_at).toBe(true);
      expect(await store.readDigest(created.id)).toEqual(updated);
    });

  it('accepts a returned replacement record', async () => {
    const id = await createFile();
    const updated = await store.updateDigest(id, {
      mutate: (d) => ({
        ...d,
        related: [{ id: mintGuid(), type: 'converted_to' as const }],
      }),
    });
    expect(updated.related).toHaveLength(1);
  });

  it('rewrites raw bytes and recomputes hash and size', async () => {
    const id = await createFile();
    const updated = await store.updateDigest(id, { bytes: '# Guide v2\n' });
    expect(updated.file.hash).toBe(hashBytes('# Guide v2\n'));
    expect(updated.file.size_bytes).toBe(11);
    const raw = readFileSync(
      join(store.paths.artefactDir(id), 'guide.md'), 'utf8',
    );
    expect(raw).toBe('# Guide v2\n');
  });

  it('index-only updates leave digest.json untouched', async () => {
    const id = await createFile();
    const before = readFileSync(store.paths.digestPath(id), 'utf8');
    await store.updateDigest(id, { index: { fresh_until: T0 } });
    expect(readFileSync(store.paths.digestPath(id), 'utf8')).toBe(before);
    const entry = await store.readIndexEntry(id);
    expect(entry?.fresh_until).toBe(T0);
    expect(entry?.updated_at).toBeDefined();
    // Cache fields set at create survive a partial overlay.
    expect(entry?.origin_etag).toBe('W/"abc"');
  });

  it('throws for unknown artefacts', async () => {
    await expect(store.updateDigest(mintGuid(), { bytes: 'x' }))
      .rejects.toThrow(/unknown artefact/);
  });

  it('rejects identity changes from mutate', async () => {
    const id = await createFile();
    await expect(store.updateDigest(id, {
      mutate: (d) => { d.origin_uri = 'https://other.dev/'; },
    })).rejects.toThrow(/cannot change id, type or origin_uri/);
  });

  it('rejects raw file renames from mutate', async () => {
    const id = await createFile();
    await expect(store.updateDigest(id, {
      mutate: (d) => { d.file.name = 'other.md'; },
    })).rejects.toThrow(/cannot rename/);
  });

  it('rejects mutate results that break the schema', async () => {
    const id = await createFile();
    await expect(store.updateDigest(id, {
      mutate: (d) => { d.file.hash = 'garbage'; },
    })).rejects.toThrow(/invalid digest record/);
  });
});

describe('writeChunk', () => {
  it('writes the chunk file and upserts its record', async () => {
    const id = await createFile();
    const chunk = await store.writeChunk(id, {
      index: 0, name: 'part-0.md', bytes: 'part 0',
      chunkMeta: 'sections 1-4',
    });
    expect(chunk).toMatchObject({
      index: 0,
      hash: hashBytes('part 0'),
      size_bytes: 6,
      chunk_meta: 'sections 1-4',
    });
    expect(fileURLToPath(chunk.uri))
      .toBe(join(store.paths.chunksDir(id), 'part-0.md'));
    expect(readFileSync(fileURLToPath(chunk.uri), 'utf8')).toBe('part 0');
    const digest = await store.readDigest(id);
    expect(digest?.file.chunks).toEqual([chunk]);
    expect(digest?.updated_at).toBeDefined();
  });

  it('keeps chunks ordered by index and replaces by index', async () => {
    const id = await createFile();
    await store.writeChunk(id, {
      index: 1, name: 'part-1.md', bytes: 'one', chunkMeta: 'sections 5-8',
    });
    const first = await store.writeChunk(id, {
      index: 0, name: 'part-0.md', bytes: 'zero', chunkMeta: 'sections 1-4',
    });
    const replaced = await store.writeChunk(id, {
      index: 0, name: 'part-0.md', bytes: 'zero v2',
      chunkMeta: 'sections 1-4',
    });
    expect(replaced.created_at).toBe(first.created_at);
    expect(replaced.updated_at).toBeDefined();
    expect(replaced.hash).toBe(hashBytes('zero v2'));
    const digest = await store.readDigest(id);
    expect(digest?.file.chunks?.map((c) => c.index)).toEqual([0, 1]);
    expect(digest?.file.chunks?.[0].hash).toBe(hashBytes('zero v2'));
  });

  it('throws for unknown artefacts', async () => {
    await expect(store.writeChunk(mintGuid(), {
      index: 0, name: 'x', bytes: 'x', chunkMeta: 'x',
    })).rejects.toThrow(/unknown artefact/);
  });
});

describe('index', () => {
  it('holds one entry per artefact, no duplicates across updates',
    async () => {
      const id = await createFile();
      await store.createDigest({
        originUri: URI,
        type: 'document',
        file: { name: 'guide.md', mimeType: 'text/markdown', bytes: '#' },
        document: docBranch(),
      });
      await store.updateDigest(id, { bytes: 'v2' });
      const entries = await store.readIndex();
      expect(entries).toHaveLength(2);
      expect(entries.filter((e) => e.artefact_id === id)).toHaveLength(1);
    });

  it('returns [] when no index exists yet', async () => {
    expect(await store.readIndex()).toEqual([]);
    expect(await store.readIndexEntry(mintGuid())).toBeNull();
  });

  it('throws clear errors on corrupt or invalid index files', async () => {
    await createFile();
    writeFileSync(store.paths.indexPath, '{oops');
    await expect(store.readIndex()).rejects.toThrow(/corrupt artefact index/);
    writeFileSync(store.paths.indexPath, '[{"artefact_id": 1}]');
    await expect(store.readIndex()).rejects.toThrow(/invalid artefact index/);
  });
});

describe('concurrent upserts', () => {
  it('serialises 8 parallel creates without losing index entries',
    async () => {
      const uris = Array.from(
        { length: 8 }, (_, i) => `https://example.com/p${i}.md`,
      );
      await Promise.all(uris.map((uri) => store.createDigest({
        originUri: uri,
        type: 'file',
        file: { name: 'f.md', mimeType: 'text/markdown', bytes: uri },
      })));
      await store.flush();
      const raw = readFileSync(store.paths.indexPath, 'utf8');
      const entries = JSON.parse(raw) as { artefact_id: string }[];
      expect(entries).toHaveLength(8);
      const ids = new Set(entries.map((e) => e.artefact_id));
      expect(ids.size).toBe(8);
    });
});

describe('safeFileName', () => {
  it('neutralises separators, reserved chars and control chars', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j.md'))
      .toBe('a_b_c_d_e_f_g_h_i_j.md');
    expect(safeFileName(`bell${String.fromCharCode(7)}.md`))
      .toBe('bell_.md');
  });

  it('refuses relative segments and empty names', () => {
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName(' . ')).toBe('file');
  });

  it('strips leading/trailing dots and spaces', () => {
    expect(safeFileName(' report.md. ')).toBe('report.md');
  });

  it('prefixes Windows-reserved device names', () => {
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('aux.md')).toBe('_aux.md');
    expect(safeFileName('console.md')).toBe('console.md');
  });

  it('caps very long names at 128 chars, keeping the tail', () => {
    const long = `${'a'.repeat(200)}.md`;
    const safe = safeFileName(long);
    expect(safe).toHaveLength(128);
    expect(safe.endsWith('.md')).toBe(true);
  });
});
