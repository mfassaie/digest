import { isShortId, artefactId } from '../store/ids.js';
import type { Digest } from '../store/record.js';
import {
  fetchFileArtefact, type FetchFileResult, type PipelineDeps,
} from '../fetch/fetch-file.js';
import { classifyResource } from '../fetch/local-file.js';
import { provisionalMime } from '../settings/mime.js';
import {
  convertMarkdownFile, isMarkdownSource, isMarkdownUri,
} from './convert-md.js';

// read_document resolution (plan M4, design §4): resource is a uri or an
// artefact id, disambiguated by shape (22-char base64url id vs anything
// else). A file-type id hops its converted_to relation. Conversion happens
// on demand for markdown sources; everything else is reported as
// unsupported until its adapter lands (format roadmap).

export type ReadDocumentResult =
  | { kind: 'document'; digest: Digest; sourceChanged: boolean }
  | { kind: 'unsupported'; name: string; mime: string }
  | { kind: 'redirect'; fromUrl: string; toUrl: string }
  | { kind: 'browser-needed'; mime: string }
  | { kind: 'error'; reason: string };

// source_changed is plumbed through to the response but stays false until
// M7 wires the source_file_hash divergence check (design §2.6).
function documentResult(digest: Digest): ReadDocumentResult {
  return { kind: 'document', digest, sourceChanged: false };
}

export async function readDocumentArtefact(
  deps: PipelineDeps, resource: string,
): Promise<ReadDocumentResult> {
  if (isShortId(resource)) return readById(deps, resource);

  const classified = classifyResource(resource);
  if (classified.kind === 'invalid') {
    return { kind: 'error', reason: classified.reason };
  }
  const uri = classified.url;
  const existing = await deps.store.readDigest(artefactId(uri, 'document'));
  if (existing !== null) return documentResult(existing);

  let fileDigest = await deps.store.readDigest(artefactId(uri, 'file'));
  if (fileDigest === null) {
    // Absent → fetch_file internally (design §2.3). Non-md uris are
    // refused on the provisional type before any retrieval: even a
    // successful fetch would end unsupported in v1.
    if (!isMarkdownUri(uri)) {
      return { kind: 'unsupported', name: uri, mime: provisionalMime(uri) };
    }
    const fetched: FetchFileResult = await fetchFileArtefact(deps, uri);
    if (fetched.kind !== 'digest') return fetched;
    fileDigest = fetched.digest;
  }
  return serveFromFile(deps, fileDigest);
}

async function readById(
  deps: PipelineDeps, id: string,
): Promise<ReadDocumentResult> {
  const digest = await deps.store.readDigest(id);
  if (digest === null) {
    return { kind: 'error', reason: `unknown artefact id: ${id}` };
  }
  if (digest.type === 'document') return documentResult(digest);
  const hop = digest.related?.find((r) => r.type === 'converted_to');
  if (hop !== undefined) {
    const document = await deps.store.readDigest(hop.id);
    if (document !== null) return documentResult(document);
  }
  return serveFromFile(deps, digest);
}

async function serveFromFile(
  deps: PipelineDeps, fileDigest: Digest,
): Promise<ReadDocumentResult> {
  if (!isMarkdownSource(fileDigest.file)) {
    return {
      kind: 'unsupported',
      name: fileDigest.file.name,
      mime: fileDigest.file.mime_type,
    };
  }
  // Never regenerate an existing document on read: section ids are sticky
  // and refresh policy is M7's concern.
  const existing = await deps.store.readDigest(
    artefactId(fileDigest.origin_uri, 'document'),
  );
  if (existing !== null) return documentResult(existing);
  return documentResult(await convertMarkdownFile(deps, fileDigest));
}
