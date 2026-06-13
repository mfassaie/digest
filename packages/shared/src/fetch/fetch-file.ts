import { basename } from 'node:path';
import { openDocLog } from '../jsonl-log.js';
import type { ReadEngine } from '../read-engine.js';
import { normaliseMime, provisionalMime, MIME_TO_EXT } from
  '../settings/mime.js';
import { resolveRule } from '../settings/resolve.js';
import type { Settings, TypeRule } from '../settings/schema.js';
import { artefactId } from '../store/ids.js';
import type { Digest } from '../store/record.js';
import type { ArtefactStore } from '../store/store.js';
import type {
  ContainerTransport, ContainerFetchResponse, PipelineInstruction,
  DockerUnavailableError,
} from '../types.js';
import { httpFetch } from './http-engine.js';
import { classifyResource, readLocalFile } from './local-file.js';

// The fetch_file pipeline (plan M4 + M9, ADR-010/011): resolve the
// provisional rule, retrieve via local http engine OR dispatch to the
// container when the rule requires it, write the file Digest and return it.

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
  // M9: container transport. When absent, container-needing rules
  // soft-error. Wired in production by app/digest via @digest/docker.
  containerTransport?: ContainerTransport;
}

export type FetchFileResult =
  | { kind: 'digest'; digest: Digest; source: 'network' | 'cache' | 'file' }
  | { kind: 'redirect'; fromUrl: string; toUrl: string }
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

// Statuses that commonly signal bot protection (design section 4.6).
const BLOCK_STATUSES = new Set([402, 403, 429, 503]);

// Build the instruction the container expects from a resolved rule.
function instructionFromRule(rule: TypeRule): PipelineInstruction {
  return {
    retrieval: rule.retrieval,
    parser: rule.parser,
    escalate: rule.escalate,
  };
}

// Docker availability check (design section 4.5): returns true when the
// transport is present and ensure() succeeds. Catches DockerUnavailable
// and returns false so local-only pipelines degrade gracefully.
async function ensureDocker(
  transport: ContainerTransport | undefined,
): Promise<{ baseUrl: string } | null> {
  if (transport === undefined) return null;
  try {
    return await transport.ensure();
  } catch (err) {
    if ((err as { name?: string }).name === 'DockerUnavailableError') {
      return null;
    }
    throw err;
  }
}

// Store the file from a container response's content field.
function containerContentBytes(content: { raw: string }): Uint8Array {
  return Uint8Array.from(Buffer.from(content.raw, 'base64'));
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
  const deadlineMs = deps.settings.fetch.timeout_seconds * 1000;
  const deadline = Date.now() + deadlineMs;
  const remaining = (): number =>
    Math.max(0, Math.floor((deadline - Date.now()) / 1000));

  const entry = prev === null
    ? null : await deps.store.readIndexEntry(id);
  const validators = entry !== null
    && (entry.origin_etag !== undefined || entry.last_modified !== undefined)
    ? { etag: entry.origin_etag, lastModified: entry.last_modified }
    : undefined;

  // M9: container dispatch. When the rule needs the browser (which
  // structurally implies container), or the runtime is container and a
  // transport is available, dispatch to the container.
  if (rule.retrieval === 'browser') {
    return containerDispatch(
      deps, resource.url, rule, validators, prev, id, log, remaining,
    );
  }

  // Local HTTP fetch path: retrieval is 'http'.
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
      // M9: authoritative re-dispatch. If the authoritative type resolves
      // to a rule needing the browser and we fetched locally, re-dispatch
      // once to the container within the remaining budget (design section
      // 4.3). Single re-dispatch invariant: we never chain beyond one.
      const authRule = resolveRule(deps.settings, mime);
      if (authRule.retrieval === 'browser' && remaining() > 0) {
        const reResult = await containerDispatch(
          deps, resource.url, authRule, undefined, prev, id, log, remaining,
        );
        if (reResult.kind !== 'error') {
          log?.write({ event: 're-dispatch', from: 'local', to: 'container' });
          return reResult;
        }
        // Re-dispatch failed (Docker unavailable): accept local result.
      }
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
    case 'http-error': {
      // M9: bot-block escalation (design section 4.6). If the rule allows
      // escalation and Docker is available, re-dispatch to the container
      // with browser retrieval.
      if (rule.escalate === 'browser'
        && BLOCK_STATUSES.has(outcome.status) && remaining() > 0) {
        const escalatedRule: TypeRule = {
          ...rule, retrieval: 'browser', runtime: 'container',
        };
        const escResult = await containerDispatch(
          deps, resource.url, escalatedRule, undefined, prev, id, log,
          remaining,
        );
        if (escResult.kind !== 'error') {
          log?.write({
            event: 'escalation', from: 'local', status: outcome.status,
          });
          return escResult;
        }
        // Escalation failed (Docker unavailable): return original error.
      }
      return { kind: 'error', reason: `HTTP ${outcome.status}` };
    }
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

// Container dispatch: ensure the container, POST /fetch with the
// instruction, and store the result. Returns an error result when Docker
// is unavailable (soft error per design section 4.5).
async function containerDispatch(
  deps: PipelineDeps,
  url: string,
  rule: TypeRule,
  validators: { etag?: string; lastModified?: string } | undefined,
  prev: Digest | null,
  id: string,
  log: ReturnType<typeof openDocLog> | undefined,
  remainingSeconds: () => number,
): Promise<FetchFileResult> {
  const docker = await ensureDocker(deps.containerTransport);
  if (docker === null) {
    const msg = 'this fetch needs the stealth browser but Docker is not ' +
      'available. Run `npx digest setup` to build the local Docker image.';
    log?.write({ event: 'docker-unavailable' });
    return { kind: 'error', reason: msg };
  }

  const timeoutSec = Math.max(1, remainingSeconds());
  const response = await deps.containerTransport!.fetch(docker.baseUrl, {
    url,
    timeoutSeconds: timeoutSec,
    rawOnly: false,
    validators,
    instruction: instructionFromRule(rule),
  });
  log?.write({ event: 'container', outcome: response.outcome });

  return processContainerResponse(
    deps, response, url, prev, id,
  );
}

function processContainerResponse(
  deps: PipelineDeps,
  response: ContainerFetchResponse,
  url: string,
  prev: Digest | null,
  id: string,
): Promise<FetchFileResult> | FetchFileResult {
  switch (response.outcome) {
    case 'fetched': {
      const mime = normaliseMime(response.contentType);
      const bytes = containerContentBytes(response.content);
      return (async () => {
        const digest = await deps.store.createDigest({
          originUri: url,
          type: 'file',
          file: {
            name: fileNameForUrl(response.finalUrl, mime),
            mimeType: mime,
            bytes,
          },
          related: prev?.related,
          index: {
            origin_etag: response.etag,
            last_modified: response.lastModified,
            last_fetched: stampOf(deps),
          },
        });
        return { kind: 'digest' as const, digest, source: 'network' as const };
      })();
    }
    case 'not-modified':
      if (prev === null) {
        return {
          kind: 'error',
          reason: 'origin replied 304 but no stored artefact exists',
        };
      }
      return (async () => {
        const digest = await deps.store.updateDigest(id, {
          index: { last_fetched: stampOf(deps) },
        });
        return { kind: 'digest' as const, digest, source: 'cache' as const };
      })();
    case 'cross-host-redirect':
      return {
        kind: 'redirect',
        fromUrl: response.fromUrl, toUrl: response.toUrl,
      };
    case 'http-error':
      return { kind: 'error', reason: `HTTP ${response.status}` };
    case 'timeout':
      return {
        kind: 'error',
        reason: 'timed out after ' +
          `${deps.settings.fetch.timeout_seconds}s`,
      };
    case 'fetch-failed':
      return { kind: 'error', reason: response.reason };
  }
}
