import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planChunks, resolveChunkStrategy } from '../chunking/chunker.js';
import { openDocLog } from '../jsonl-log.js';
import type { DocumentSection } from '../md-engine/types.js';
import type { ReadEngine } from '../read-engine.js';
import { normaliseMime, provisionalMime, MIME_TO_EXT } from
  '../settings/mime.js';
import { resolveRule } from '../settings/resolve.js';
import type { Settings } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import type { Digest } from '../store/record.js';
import type { ArtefactStore } from '../store/store.js';
import { evaluateFreshness, computeFreshUntil } from './freshness.js';
import { httpFetch } from './http-engine.js';
import { classifyResource, readLocalFile } from './local-file.js';

// The fetch_file pipeline, v1 (plan M4, ADR-011 §2.3 step 1): resolve the
// provisional rule (M1), retrieve via the LOCAL http engine or a local
// file read, write the file Digest (M2) and return it. The container
// runtime is not wired until M9: rules whose retrieval is plain 'http'
// execute locally even when their runtime says 'container' (raw bytes over
// plain http are runtime-indifferent, so this is faithful, not a
// fallback); rules needing the stealth browser cannot be satisfied and
// are reported as such.

// Injected dependencies, shared by every pipeline entry point (the
// ServerDeps pattern): mcp-server passes its deps straight through.
export interface PipelineDeps {
  store: ArtefactStore;
  settings: Settings;
  // Extracts engine for document conversion; defaults to the extractive
  // engine when omitted.
  engine?: ReadEngine;
  // Injectable network fetch (tests); defaults to global fetch.
  fetchImpl?: typeof fetch;
  // When set, per-document pipeline events go to
  // <logsDir>/docs/{artefact-id}/pipeline.jsonl (design §3).
  logsDir?: string;
  now?: () => Date;
}

export type ChunkMode = 'none' | 'standard';

export type FetchFileResult =
  | { kind: 'digest'; digest: Digest; source: 'network' | 'cache' | 'file' }
  | { kind: 'redirect'; fromUrl: string; toUrl: string }
  // The resolved rule needs the stealth browser — container support lands
  // in M9.
  | { kind: 'browser-needed'; mime: string }
  | { kind: 'error'; reason: string };

function stampOf(deps: PipelineDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

// Chunk a freshly written digest when chunk_mode is 'standard' (plan M8).
// Resolves the per-MIME strategy from settings, plans the chunks, reads the
// raw file, slices it, and writes each chunk via store.writeChunk. For
// markdown with strategy 'sections', parses the content to get top-level
// sections from the fold output. Returns the updated digest with chunks.
async function applyChunking(
  deps: PipelineDeps, digest: Digest,
): Promise<Digest> {
  const mime = digest.file.mime_type;
  const strategy = resolveChunkStrategy(deps.settings, mime);
  const rawPath = fileURLToPath(digest.file.uri);
  const rawBytes = await readFile(rawPath);

  let sections: DocumentSection[] | undefined;
  if (strategy.strategy === 'sections') {
    // Lazy import to avoid pulling in the remark pipeline for non-md
    // files. The md-engine fold gives top-level sections with byte
    // positions, which is exactly what the section chunker needs.
    const { parseMarkdown } = await import('../md-engine/fold.js');
    const root = parseMarkdown(rawBytes.toString('utf8'));
    sections = root.children;
  }

  const descriptors = planChunks(rawBytes.byteLength, strategy, sections);
  if (descriptors.length === 0) return digest;

  let latest = digest;
  for (const desc of descriptors) {
    const chunkBytes = rawBytes.subarray(desc.byteStart, desc.byteEnd);
    const ext = digest.file.name.includes('.')
      ? `.${digest.file.name.split('.').pop()!}` : '';
    const name = `chunk-${String(desc.index).padStart(4, '0')}${ext}`;
    await deps.store.writeChunk(digest.id, {
      index: desc.index,
      name,
      bytes: chunkBytes,
      chunkMeta: desc.chunkMeta,
    });
    // Read the updated digest after the last chunk write to get the
    // full chunks array. writeChunk updates digest.json each time.
    if (desc.index === descriptors[descriptors.length - 1]!.index) {
      const updated = await deps.store.readDigest(digest.id);
      if (updated !== null) latest = updated;
    }
  }
  return latest;
}

// readDigest throws on a corrupt record; the pipeline treats that the same
// as absent (createDigest replaces corrupt records by design).
async function readDigestSafe(
  store: ArtefactStore, id: string,
): Promise<Digest | null> {
  try {
    return await store.readDigest(id);
  } catch {
    return null;
  }
}

// File name for a fetched url: the decoded basename of its path, falling
// back to a mime-derived 'download.<ext>'.
function fileNameForUrl(finalUrl: string, mime: string): string {
  let path = '';
  try {
    path = new URL(finalUrl).pathname;
  } catch {
    path = '';
  }
  let name = basename(path);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw segment
  }
  if (name !== '') return name;
  const ext = MIME_TO_EXT[mime];
  return ext === undefined ? 'download' : `download.${ext}`;
}

export async function fetchFileArtefact(
  deps: PipelineDeps, rawUri: string,
  chunkMode: ChunkMode = 'none',
): Promise<FetchFileResult> {
  const resource = classifyResource(rawUri);
  if (resource.kind === 'invalid') {
    return { kind: 'error', reason: resource.reason };
  }
  const id = artefactId(resource.url, 'file');
  // Opened at pipeline start: the id is derivable pre-network (design §3).
  const log = deps.logsDir === undefined
    ? undefined : openDocLog(deps.logsDir, id);
  log?.write({ event: 'fetch_file', uri: resource.url });
  // Relations survive a re-fetch: a converted_to link recorded by a prior
  // read_document must not be lost when the raw file is re-created.
  const prev = await readDigestSafe(deps.store, id);

  if (resource.kind === 'file') {
    let content;
    try {
      content = await readLocalFile(resource.path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log?.write({ event: 'error', reason });
      return { kind: 'error', reason };
    }
    let digest = await deps.store.createDigest({
      originUri: resource.url,
      type: 'file',
      file: content,
      related: prev?.related,
    });
    log?.write({ event: 'stored', source: 'file', hash: digest.file.hash });
    if (chunkMode === 'standard') {
      digest = await applyChunking(deps, digest);
      log?.write({
        event: 'chunked', count: digest.file.chunks?.length ?? 0,
      });
    }
    return { kind: 'digest', digest, source: 'file' };
  }

  const provisional = provisionalMime(resource.url);
  const rule = resolveRule(deps.settings, provisional);
  if (rule.retrieval === 'browser') {
    log?.write({ event: 'browser-needed', mime: provisional });
    return { kind: 'browser-needed', mime: provisional };
  }

  const entry = prev === null
    ? null : await deps.store.readIndexEntry(id);

  // SWR freshness check (ADR-011 design 2.6, plan M7): fresh entries
  // return the stored Digest without any network call; stale entries
  // return the stored Digest immediately and fire a background
  // revalidation; misses go through the synchronous fetch path.
  const now = deps.now?.() ?? new Date();
  const verdict = evaluateFreshness(entry, { now });

  if (verdict.status === 'fresh' && prev !== null) {
    log?.write({ event: 'fresh', source: 'cache' });
    return { kind: 'digest', digest: prev, source: 'cache' };
  }

  if (verdict.status === 'stale' && prev !== null) {
    log?.write({ event: 'stale', source: 'cache' });
    // Fire background revalidation: abort-bounded, fire-and-forget,
    // errors logged to the artefact's pipeline jsonl.
    fireBackgroundRevalidation(deps, resource.url, id, provisional, prev,
      entry, log);
    return { kind: 'digest', digest: prev, source: 'cache' };
  }

  // Miss: synchronous fetch with retries from settings.
  return synchronousFetch(
    deps, resource.url, id, provisional, prev, entry, log, chunkMode,
  );
}

// Background revalidation (SWR, plan M7): fire-and-forget, abort-bounded
// with remaining fetch budget, errors caught and logged.
function fireBackgroundRevalidation(
  deps: PipelineDeps,
  url: string,
  id: string,
  provisional: string,
  prev: Digest,
  entry: import('../store/record.js').ArtefactIndexEntry | null,
  log: import('../jsonl-log.js').JsonlWriter | undefined,
): void {
  const controller = new AbortController();
  const budget = deps.settings.fetch.timeout_seconds * 1000;
  const timer = setTimeout(() => controller.abort(), budget);

  const work = async (): Promise<void> => {
    try {
      const validators = entry !== null
        && (entry.origin_etag !== undefined
            || entry.last_modified !== undefined)
        ? { etag: entry.origin_etag, lastModified: entry.last_modified }
        : undefined;
      // Wrap fetchImpl to honour the abort signal.
      const boundFetch: typeof fetch = async (input, init) => {
        const merged = {
          ...init,
          signal: controller.signal,
        };
        return (deps.fetchImpl ?? fetch)(input, merged);
      };
      const outcome = await httpFetch({
        url,
        timeoutSeconds: deps.settings.fetch.timeout_seconds,
        retries: 0,
        validators,
      }, { fetchImpl: boundFetch });
      log?.write({
        event: 'revalidate', outcome: outcome.outcome,
      });

      switch (outcome.outcome) {
        case 'fetched': {
          const mime = outcome.contentType === undefined
            ? provisional : normaliseMime(outcome.contentType);
          const now = deps.now?.() ?? new Date();
          const freshUntil = computeFreshUntil(
            collectResponseHeaders(outcome), { now },
          );
          await deps.store.createDigest({
            originUri: url,
            type: 'file',
            file: {
              name: fileNameForUrl(outcome.finalUrl, mime),
              mimeType: mime,
              bytes: outcome.bytes,
            },
            related: prev.related,
            index: {
              origin_etag: outcome.etag,
              last_modified: outcome.lastModified,
              last_fetched: now.toISOString(),
              fresh_until: freshUntil,
            },
          });
          break;
        }
        case 'not-modified': {
          const now = deps.now?.() ?? new Date();
          await deps.store.updateDigest(id, {
            index: { last_fetched: now.toISOString() },
          });
          break;
        }
        default:
          log?.write({
            event: 'revalidate-failed', outcome: outcome.outcome,
          });
          break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log?.write({ event: 'revalidate-error', reason });
    } finally {
      clearTimeout(timer);
    }
  };

  // Fire-and-forget: the caller does not await this.
  void work();
}

function collectResponseHeaders(
  outcome: {
    contentType?: string; etag?: string; lastModified?: string;
    cacheControl?: string; expires?: string;
  },
): Record<string, string> {
  const h: Record<string, string> = {};
  if (outcome.contentType !== undefined) {
    h['content-type'] = outcome.contentType;
  }
  if (outcome.etag !== undefined) h['etag'] = outcome.etag;
  if (outcome.lastModified !== undefined) {
    h['last-modified'] = outcome.lastModified;
  }
  if (outcome.cacheControl !== undefined) {
    h['cache-control'] = outcome.cacheControl;
  }
  if (outcome.expires !== undefined) h['expires'] = outcome.expires;
  return h;
}

// Synchronous fetch path (miss or explicit re-fetch): retries from
// settings, cache headers updated.
async function synchronousFetch(
  deps: PipelineDeps,
  url: string,
  id: string,
  provisional: string,
  prev: Digest | null,
  entry: import('../store/record.js').ArtefactIndexEntry | null,
  log: import('../jsonl-log.js').JsonlWriter | undefined,
  chunkMode: ChunkMode = 'none',
): Promise<FetchFileResult> {
  const validators = entry !== null
    && (entry.origin_etag !== undefined || entry.last_modified !== undefined)
    ? { etag: entry.origin_etag, lastModified: entry.last_modified }
    : undefined;
  const outcome = await httpFetch({
    url,
    timeoutSeconds: deps.settings.fetch.timeout_seconds,
    retries: deps.settings.fetch.retries,
    validators,
  }, { fetchImpl: deps.fetchImpl });
  log?.write({ event: 'http', outcome: outcome.outcome });

  switch (outcome.outcome) {
    case 'fetched': {
      const mime = outcome.contentType === undefined
        ? provisional : normaliseMime(outcome.contentType);
      const now = deps.now?.() ?? new Date();
      const freshUntil = computeFreshUntil(
        collectResponseHeaders(outcome), { now },
      );
      let digest = await deps.store.createDigest({
        originUri: url,
        type: 'file',
        file: {
          name: fileNameForUrl(outcome.finalUrl, mime),
          mimeType: mime,
          bytes: outcome.bytes,
        },
        related: prev?.related,
        index: {
          origin_etag: outcome.etag,
          last_modified: outcome.lastModified,
          last_fetched: stampOf(deps),
          fresh_until: freshUntil,
        },
      });
      log?.write({
        event: 'stored', source: 'network', hash: digest.file.hash,
      });
      if (chunkMode === 'standard') {
        digest = await applyChunking(deps, digest);
        log?.write({
          event: 'chunked', count: digest.file.chunks?.length ?? 0,
        });
      }
      return { kind: 'digest', digest, source: 'network' };
    }
    case 'not-modified': {
      if (prev === null) {
        return {
          kind: 'error',
          reason: 'origin replied 304 but no stored artefact exists',
        };
      }
      const digest = await deps.store.updateDigest(id, {
        index: { last_fetched: stampOf(deps) },
      });
      return { kind: 'digest', digest, source: 'cache' };
    }
    case 'cross-host-redirect':
      return {
        kind: 'redirect', fromUrl: outcome.fromUrl, toUrl: outcome.toUrl,
      };
    case 'http-error':
      return { kind: 'error', reason: `HTTP ${outcome.status}` };
    case 'timeout':
      return {
        kind: 'error',
        reason: 'timed out after ' +
          `${deps.settings.fetch.timeout_seconds}s`,
      };
    case 'fetch-failed':
      return { kind: 'error', reason: outcome.reason };
  }
}
