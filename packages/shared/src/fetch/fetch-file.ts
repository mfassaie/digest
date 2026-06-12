import { basename } from 'node:path';
import { openDocLog } from '../jsonl-log.js';
import type { ReadEngine } from '../read-engine.js';
import { normaliseMime, provisionalMime, MIME_TO_EXT } from
  '../settings/mime.js';
import { resolveRule } from '../settings/resolve.js';
import type { Settings } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import type { Digest } from '../store/record.js';
import type { ArtefactStore } from '../store/store.js';
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
    const digest = await deps.store.createDigest({
      originUri: resource.url,
      type: 'file',
      file: content,
      related: prev?.related,
    });
    log?.write({ event: 'stored', source: 'file', hash: digest.file.hash });
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
  const validators = entry !== null
    && (entry.origin_etag !== undefined || entry.last_modified !== undefined)
    ? { etag: entry.origin_etag, lastModified: entry.last_modified }
    : undefined;
  const outcome = await httpFetch({
    url: resource.url,
    timeoutSeconds: deps.settings.fetch.timeout_seconds,
    retries: deps.settings.fetch.retries,
    validators,
  }, { fetchImpl: deps.fetchImpl });
  log?.write({ event: 'http', outcome: outcome.outcome });

  switch (outcome.outcome) {
    case 'fetched': {
      const mime = outcome.contentType === undefined
        ? provisional : normaliseMime(outcome.contentType);
      const digest = await deps.store.createDigest({
        originUri: resource.url,
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
        },
      });
      log?.write({
        event: 'stored', source: 'network', hash: digest.file.hash,
      });
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
