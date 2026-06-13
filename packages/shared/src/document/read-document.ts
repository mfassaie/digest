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
import { convertHtmlFile, isHtmlSource, isHtmlUri } from './convert-html.js';

// read_document resolution (plan M4 + M9, design §4): resource is a uri
// or an artefact id, disambiguated by shape (22-char base64url id vs
// anything else). A file-type id hops its converted_to relation.
// Conversion happens on demand for markdown and HTML sources; everything
// else is reported as unsupported until its adapter lands (format roadmap).

export type ReadDocumentResult =
  | { kind: 'document'; digest: Digest; sourceChanged: boolean }
  | { kind: 'unsupported'; name: string; mime: string }
  | { kind: 'redirect'; fromUrl: string; toUrl: string }
  | { kind: 'error'; reason: string };

// Source-change divergence detection (ADR-011 design 2.6, plan M7):
// compare the document's source_file_hash against the source file
// Digest's current file.hash. If they differ, the source has been
// re-fetched with new content since the document was last converted.
async function checkSourceChanged(
  deps: PipelineDeps, docDigest: Digest,
): Promise<boolean> {
  if (docDigest.document === undefined) return false;
  const sourceRelation = docDigest.related?.find(
    (r) => r.type === 'converted_from',
  );
  if (sourceRelation === undefined) return false;
  const sourceDigest = await deps.store.readDigest(sourceRelation.id);
  if (sourceDigest === null) return false;
  return sourceDigest.file.hash !== docDigest.document.source_file_hash;
}

// When the source has changed but the document is untouched since
// conversion, auto-regenerate the document from the updated source
// (design 2.6). The document is "untouched" if its master md's hash
// matches the source file's hash at the time of conversion (i.e.
// file.hash === document.source_file_hash). If the document has been
// locally edited, we never auto-overwrite: report source_changed instead.
async function resolveDocumentResult(
  deps: PipelineDeps, docDigest: Digest,
): Promise<ReadDocumentResult> {
  const changed = await checkSourceChanged(deps, docDigest);
  if (!changed) {
    return { kind: 'document', digest: docDigest, sourceChanged: false };
  }

  // Source has changed. Check whether the document's own content has been
  // edited since conversion: if file.hash equals source_file_hash, the
  // master md is still the verbatim copy from conversion, so we can
  // safely regenerate.
  const doc = docDigest.document!;
  const untouched = docDigest.file.hash === doc.source_file_hash;
  if (!untouched) {
    // Document was locally edited: never auto-overwrite.
    return { kind: 'document', digest: docDigest, sourceChanged: true };
  }

  // Regenerate: re-convert from the updated source file Digest.
  const sourceRelation = docDigest.related!.find(
    (r) => r.type === 'converted_from',
  )!;
  const sourceDigest = await deps.store.readDigest(sourceRelation.id);
  if (sourceDigest === null) {
    // Source disappeared: serve stale document with the divergence flag.
    return { kind: 'document', digest: docDigest, sourceChanged: true };
  }
  const regenerated = await convertMarkdownFile(deps, sourceDigest);
  return { kind: 'document', digest: regenerated, sourceChanged: false };
}

// Check whether a URI's provisional type is convertible (md or html).
function isConvertibleUri(uri: string): boolean {
  return isMarkdownUri(uri) || isHtmlUri(uri);
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
  if (existing !== null) return resolveDocumentResult(deps, existing);

  let fileDigest = await deps.store.readDigest(artefactId(uri, 'file'));
  if (fileDigest === null) {
    // Absent: fetch_file internally (design section 2.3). Non-convertible
    // uris are refused on the provisional type before any retrieval.
    if (!isConvertibleUri(uri)) {
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
  if (digest.type === 'document') {
    return resolveDocumentResult(deps, digest);
  }
  const hop = digest.related?.find((r) => r.type === 'converted_to');
  if (hop !== undefined) {
    const document = await deps.store.readDigest(hop.id);
    if (document !== null) return resolveDocumentResult(deps, document);
  }
  return serveFromFile(deps, digest);
}

async function serveFromFile(
  deps: PipelineDeps, fileDigest: Digest,
): Promise<ReadDocumentResult> {
  // If a document Digest already exists, run divergence check (M7).
  const existing = await deps.store.readDigest(
    artefactId(fileDigest.origin_uri, 'document'),
  );
  if (existing !== null) return resolveDocumentResult(deps, existing);

  // M9: HTML sources converted via defuddle + linkedom -> md -> fold.
  if (isHtmlSource(fileDigest.file)) {
    const converted = await convertHtmlFile(deps, fileDigest);
    return { kind: 'document', digest: converted, sourceChanged: false };
  }
  if (isMarkdownSource(fileDigest.file)) {
    const converted = await convertMarkdownFile(deps, fileDigest);
    return { kind: 'document', digest: converted, sourceChanged: false };
  }
  return {
    kind: 'unsupported',
    name: fileDigest.file.name,
    mime: fileDigest.file.mime_type,
  };
}
