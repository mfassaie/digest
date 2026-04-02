import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { hashBytes } from './hash.js';
import { artefactId, isShortId } from './ids.js';
import {
  ArtefactIndexEntrySchema, ArtefactIndexSchema, DigestSchema,
  type ArtefactIndexEntry, type ArtefactRelation, type ArtefactType,
  type Digest, type DigestDocument, type FileChunk, type IndexCacheFields,
} from './record.js';

// The artefact store (ADR-011, design §3): one dir per artefact under
// {root}/artefact/{id}/ holding the raw file under its original name, a
// chunks/ dir and digest.json, plus the corpus index at
// {root}/artefact/artefact-index.json. The root is an injected parameter
// (ServerDeps pattern) — env wiring (DIGEST_ARTEFACT_ROOT) stays in the
// app. The host writes all files (ADR-009). Concurrent index writes are a
// known deferred risk (single-writer assumption).

export interface ArtefactStorePaths {
  root: string;
  artefactRoot: string;
  indexPath: string;
  artefactDir(id: string): string;
  digestPath(id: string): string;
  chunksDir(id: string): string;
}

export interface CreateDigestParams {
  originUri: string;
  type: ArtefactType;
  file: { name: string; mimeType: string; bytes: Uint8Array | string };
  document?: DigestDocument;
  related?: ArtefactRelation[];
  // Web-cache fields for the index entry (file artefacts only).
  index?: IndexCacheFields;
}

// General update surface: M6 (write_section) replaces the master md bytes
// and mutates the document branch; M7 (SWR) refreshes raw bytes and/or the
// index web-cache fields; M8 attaches chunks via writeChunk. None of them
// should need to edit this module.
export interface UpdateDigestParams {
  // New raw file content, written under the existing file.name; file.hash
  // and file.size_bytes are recomputed before mutate runs.
  bytes?: Uint8Array | string;
  // Arbitrary record changes (document branch, related, ...). Mutate in
  // place or return a replacement. id, type, origin_uri and file.name are
  // immutable.
  mutate?: (digest: Digest) => Digest | void;
  // Merged over the index entry's web-cache fields. An index-only update
  // (neither bytes nor mutate) leaves digest.json untouched.
  index?: IndexCacheFields;
}

export interface WriteChunkParams {
  index: number;
  name: string;
  bytes: Uint8Array | string;
  chunkMeta: string;
}

export interface ArtefactStore {
  paths: ArtefactStorePaths;
  createDigest(params: CreateDigestParams): Promise<Digest>;
  readDigest(id: string): Promise<Digest | null>;
  updateDigest(id: string, params: UpdateDigestParams): Promise<Digest>;
  // Writes a chunk file under chunks/ and upserts its FileChunk record
  // (keyed by chunk index) into digest.json.
  writeChunk(id: string, params: WriteChunkParams): Promise<FileChunk>;
  readIndex(): Promise<ArtefactIndexEntry[]>;
  readIndexEntry(id: string): Promise<ArtefactIndexEntry | null>;
  // Drain the index write queue. Await before process exit to prevent
  // losing queued index writes.
  flush(): Promise<void>;
}

export interface ArtefactStoreOptions {
  now?: () => Date;
}

const UNSAFE_NAME_CHARS = '<>:"/\\|?*';
const RESERVED_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Neutralise path separators, control characters, Windows-reserved
// characters and device names, and relative segments, keeping the original
// name recognisable.
export function safeFileName(name: string): string {
  let safe = [...name]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      const unsafe = code < 0x20 || code === 0x7f
        || UNSAFE_NAME_CHARS.includes(ch);
      return unsafe ? '_' : ch;
    })
    .join('')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (safe.length > 128) safe = safe.slice(-128);
  if (safe === '') safe = 'file';
  if (RESERVED_DEVICE_RE.test(safe)) safe = `_${safe}`;
  return safe;
}

function byteLength(data: Uint8Array | string): number {
  return typeof data === 'string'
    ? Buffer.byteLength(data, 'utf8')
    : data.byteLength;
}

function pruneUndefined<T extends object>(value: T): T {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return value;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function assertArtefactId(id: string): void {
  if (!isShortId(id)) {
    throw new Error(`invalid artefact id: ${JSON.stringify(id)}`);
  }
}

export function createArtefactStore(
  root: string, options: ArtefactStoreOptions = {},
): ArtefactStore {
  const now = options.now ?? (() => new Date());
  const artefactRoot = join(root, 'artefact');
  const indexPath = join(artefactRoot, 'artefact-index.json');
  const paths: ArtefactStorePaths = {
    root,
    artefactRoot,
    indexPath,
    artefactDir: (id) => join(artefactRoot, id),
    digestPath: (id) => join(artefactRoot, id, 'digest.json'),
    chunksDir: (id) => join(artefactRoot, id, 'chunks'),
  };

  function validateDigest(record: unknown, context: string): Digest {
    const res = DigestSchema.safeParse(record);
    if (!res.success) {
      throw new Error(
        `invalid digest record (${context}):\n${z.prettifyError(res.error)}`,
      );
    }
    return res.data;
  }

  async function readDigestFile(id: string): Promise<Digest | null> {
    let raw: string;
    try {
      raw = await readFile(paths.digestPath(id), 'utf8');
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `corrupt digest.json at ${paths.digestPath(id)}: not valid JSON`,
      );
    }
    return validateDigest(data, paths.digestPath(id));
  }

  async function readIndexFile(): Promise<ArtefactIndexEntry[]> {
    let raw: string;
    try {
      raw = await readFile(indexPath, 'utf8');
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`corrupt artefact index at ${indexPath}: not valid JSON`);
    }
    const res = ArtefactIndexSchema.safeParse(data);
    if (!res.success) {
      throw new Error(
        `invalid artefact index at ${indexPath}:\n` +
        z.prettifyError(res.error),
      );
    }
    return res.data;
  }

  function cacheFieldsOf(entry: ArtefactIndexEntry): IndexCacheFields {
    const { origin_etag, fresh_until, last_modified, last_fetched } = entry;
    return { origin_etag, fresh_until, last_modified, last_fetched };
  }

  let indexQueue: Promise<void> = Promise.resolve();

  // The actual read-upsert-write cycle, called only from the queue.
  async function doUpsertIndex(
    digest: Digest, cache: IndexCacheFields | undefined,
    stamp: string | undefined,
  ): Promise<void> {
    const entries = await readIndexFile();
    const at = entries.findIndex((e) => e.artefact_id === digest.id);
    const existing = at >= 0 ? entries[at] : undefined;
    const candidate = pruneUndefined({
      artefact_id: digest.id,
      artefact_type: digest.type,
      origin_uri: digest.origin_uri,
      ...(existing ? cacheFieldsOf(existing) : {}),
      ...(cache ?? {}),
      created_at: existing?.created_at ?? digest.created_at,
      updated_at: stamp ?? existing?.updated_at,
    });
    const res = ArtefactIndexEntrySchema.safeParse(candidate);
    if (!res.success) {
      throw new Error(
        `invalid index entry for ${digest.id}:\n` +
        z.prettifyError(res.error),
      );
    }
    if (at >= 0) entries[at] = res.data;
    else entries.push(res.data);
    await mkdir(artefactRoot, { recursive: true });
    await writeJsonAtomic(indexPath, entries);
  }

  // Serialise index mutations so concurrent fetches cannot lose entries.
  function upsertIndex(
    digest: Digest, cache: IndexCacheFields | undefined,
    stamp: string | undefined,
  ): Promise<void> {
    const result = indexQueue.then(
      () => doUpsertIndex(digest, cache, stamp),
    );
    // Isolate failures: a rejected write must not break the chain.
    indexQueue = result.catch(() => {});
    return result;
  }

  return {
    paths,

    async createDigest(params) {
      const id = artefactId(params.originUri, params.type);
      const dir = paths.artefactDir(id);
      // Re-creating an artefact (same deterministic id) keeps its original
      // created_at; a corrupt previous record is simply replaced.
      let previous: Digest | null = null;
      try {
        previous = await readDigestFile(id);
      } catch {
        previous = null;
      }
      const stamp = now().toISOString();
      await rm(dir, { recursive: true, force: true });
      await mkdir(paths.chunksDir(id), { recursive: true });
      const name = safeFileName(params.file.name);
      const rawPath = join(dir, name);
      await writeFile(rawPath, params.file.bytes);
      const digest = validateDigest(pruneUndefined({
        id,
        type: params.type,
        origin_uri: params.originUri,
        created_at: previous?.created_at ?? stamp,
        updated_at: previous ? stamp : undefined,
        file: {
          name,
          uri: pathToFileURL(rawPath).href,
          hash: hashBytes(params.file.bytes),
          mime_type: params.file.mimeType,
          size_bytes: byteLength(params.file.bytes),
        },
        document: params.document,
        related: params.related,
      }), `create ${params.originUri}`);
      await writeJsonAtomic(paths.digestPath(id), digest);
      await upsertIndex(digest, params.index, previous ? stamp : undefined);
      return digest;
    },

    async readDigest(id) {
      assertArtefactId(id);
      return readDigestFile(id);
    },

    async updateDigest(id, params) {
      assertArtefactId(id);
      const current = await readDigestFile(id);
      if (current === null) {
        throw new Error(`unknown artefact: ${id}`);
      }
      const stamp = now().toISOString();
      const touched = params.bytes !== undefined
        || params.mutate !== undefined;
      let next = current;
      if (touched) {
        next = structuredClone(current);
        if (params.bytes !== undefined) {
          await writeFile(
            join(paths.artefactDir(id), next.file.name), params.bytes,
          );
          next.file.hash = hashBytes(params.bytes);
          next.file.size_bytes = byteLength(params.bytes);
        }
        if (params.mutate) {
          next = params.mutate(next) ?? next;
        }
        if (next.id !== current.id || next.type !== current.type
          || next.origin_uri !== current.origin_uri) {
          throw new Error(
            'updateDigest cannot change id, type or origin_uri',
          );
        }
        if (next.file.name !== current.file.name) {
          throw new Error(
            'updateDigest cannot rename the raw file; re-create instead',
          );
        }
        next.updated_at = stamp;
        next = validateDigest(pruneUndefined(next), `update ${id}`);
        await writeJsonAtomic(paths.digestPath(id), next);
      }
      await upsertIndex(next, params.index, stamp);
      return next;
    },

    async writeChunk(id, params) {
      assertArtefactId(id);
      const current = await readDigestFile(id);
      if (current === null) {
        throw new Error(`unknown artefact: ${id}`);
      }
      const stamp = now().toISOString();
      const name = safeFileName(params.name);
      await mkdir(paths.chunksDir(id), { recursive: true });
      const chunkPath = join(paths.chunksDir(id), name);
      await writeFile(chunkPath, params.bytes);
      const previous = current.file.chunks?.find(
        (c) => c.index === params.index,
      );
      const chunk: FileChunk = pruneUndefined({
        index: params.index,
        uri: pathToFileURL(chunkPath).href,
        hash: hashBytes(params.bytes),
        size_bytes: byteLength(params.bytes),
        chunk_meta: params.chunkMeta,
        created_at: previous?.created_at ?? stamp,
        updated_at: previous ? stamp : undefined,
      });
      const next = structuredClone(current);
      const chunks = (next.file.chunks ?? [])
        .filter((c) => c.index !== params.index);
      chunks.push(chunk);
      chunks.sort((a, b) => a.index - b.index);
      next.file.chunks = chunks;
      next.updated_at = stamp;
      const valid = validateDigest(next, `writeChunk ${id}`);
      await writeJsonAtomic(paths.digestPath(id), valid);
      await upsertIndex(valid, undefined, stamp);
      return chunk;
    },

    async readIndex() {
      return readIndexFile();
    },

    async readIndexEntry(id) {
      assertArtefactId(id);
      const entries = await readIndexFile();
      return entries.find((e) => e.artefact_id === id) ?? null;
    },

    async flush() {
      await indexQueue;
    },
  };
}
