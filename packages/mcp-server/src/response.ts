import type { Digest, DocumentSection, FileChunk } from '@digest/shared';

// Response formatting for the M4 tool surface (ADR-011 design §4):
// fetch_file returns the file Digest verbatim — the ONLY tool carrying
// file uris. read_document returns a projection of the document Digest
// with every uri omitted (file.uri, chunk uris, origin_uri), the section
// tree stripped of content arrays (§5.4: the tree IS the toc;
// read_section serves bodies in M5), and read_mode trimming the document
// branch.

export type TextResult = {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
};

export function text(body: string, isError = false): TextResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: body }],
  };
}

export function jsonText(value: unknown, isError = false): TextResult {
  return text(JSON.stringify(value, null, 2), isError);
}

export function formatError(context: string, reason: string): string {
  return `Error for ${context}\nReason: ${reason}`;
}

export function formatRedirect(fromUrl: string, toUrl: string): string {
  return [
    'Redirect detected (cross-host):',
    `  From: ${fromUrl}`,
    `  To: ${toUrl}`,
    '',
    'Make a new request with the redirect URL to fetch the content.',
  ].join('\n');
}

export type ReadMode = 'all' | 'meta_only' | 'sections_only';

export function projectDocumentDigest(
  digest: Digest, readMode: ReadMode, sourceChanged: boolean,
): Record<string, unknown> {
  const document = digest.document;
  if (document === undefined) {
    throw new Error(`digest ${digest.id} carries no document branch`);
  }
  const documentBranch: Record<string, unknown> = { name: document.name };
  if (readMode !== 'sections_only') {
    if (document.summary !== undefined) {
      documentBranch.summary = document.summary;
    }
    if (document.keywords !== undefined) {
      documentBranch.keywords = document.keywords;
    }
  }
  documentBranch.writable = document.writable;
  documentBranch.source_file_hash = document.source_file_hash;
  if (readMode !== 'meta_only') {
    documentBranch.sections = stripContent(document.sections);
  }
  return {
    id: digest.id,
    type: digest.type,
    created_at: digest.created_at,
    ...(digest.updated_at === undefined
      ? {} : { updated_at: digest.updated_at }),
    // M7 divergence: true when the source file was re-fetched with
    // new content and the document has been locally edited (design 2.6).
    source_changed: sourceChanged,
    // File identity without location (§10.10): hash/mime/size, no uris.
    file: {
      name: digest.file.name,
      hash: digest.file.hash,
      mime_type: digest.file.mime_type,
      size_bytes: digest.file.size_bytes,
      ...(digest.file.chunks === undefined
        ? {} : { chunks: digest.file.chunks.map(stripChunkUri) }),
    },
    document: documentBranch,
    ...(digest.related === undefined ? {} : { related: digest.related }),
  };
}

function stripChunkUri(chunk: FileChunk): Record<string, unknown> {
  const { uri: _uri, ...rest } = chunk;
  return rest;
}

// The tree without content arrays is the document's table of contents.
function stripContent(section: DocumentSection): Record<string, unknown> {
  const { content: _content, children, ...rest } = section;
  return {
    ...rest,
    ...(children === undefined
      ? {} : { children: children.map(stripContent) }),
  };
}
