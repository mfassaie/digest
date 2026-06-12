import { z } from 'zod';
import { HASH_STRING_RE } from './hash.js';
import { SHORT_ID_RE } from './ids.js';

// The Digest record and the ArtefactIndex, field for field per the frozen
// tooling-interface design §2.1/§2.2 (ADR-011). snake_case throughout:
// these shapes ARE the external surface (digest.json, artefact-index.json,
// tool responses). zod is the source of truth; the shipped
// digest.schema.json and artefact-index.schema.json are generated from it
// (buildDigestJsonSchema / buildArtefactIndexJsonSchema).

const shortId = z.string().regex(SHORT_ID_RE);
const hashString = z.string().regex(HASH_STRING_RE);
// Timestamps are ISO 8601 UTC (Date#toISOString output).
const isoDateTime = z.iso.datetime();

export const ArtefactTypeSchema = z.enum(['file', 'document']);
export type ArtefactType = z.infer<typeof ArtefactTypeSchema>;

// Section tree vocabulary (design §5.3): structural units only.
export const SectionTypeSchema = z.enum([
  'root', 'front-matter', 'section', 'page', 'form',
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

// Block vocabulary (design §5.3): typed payloads, never in the tree.
export const BlockTypeSchema = z.enum([
  'paragraph', 'code', 'diagram', 'table', 'image', 'list', 'quote',
  'footnote', 'html', 'break', 'form-field',
]);
export type BlockType = z.infer<typeof BlockTypeSchema>;

// meta objects are deliberately open (the design writes "..."): the named
// keys are typed, unknown keys pass through untouched.
export const SectionMetaSchema = z.looseObject({
  page_range: z.string().optional(),
  critic_rollup: z.record(z.string(), z.number()).optional(),
});
export type SectionMeta = z.infer<typeof SectionMetaSchema>;

export const BlockMetaSchema = z.looseObject({
  lang: z.string().optional(),
  callout: z.string().optional(),
  critic: z.record(z.string(), z.number()).optional(),
  // mcp-pdf's portable six-term vocabulary (design §5.3).
  field_type: z.enum([
    'text', 'checkbox', 'radio', 'dropdown', 'date', 'signature',
  ]).optional(),
  field_name: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});
export type BlockMeta = z.infer<typeof BlockMetaSchema>;

export const ContentBlockSchema = z.object({
  id: shortId,
  index: z.int().min(0),
  type: BlockTypeSchema,
  value: z.string(),
  meta: BlockMetaSchema.optional(),
  hash: hashString,
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
});
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// Section level, two collections (design Rev 3.1): a homogeneous section
// tree (children) with typed payloads in content.
export const DocumentSectionSchema = z.object({
  id: shortId,
  type: SectionTypeSchema,
  depth: z.int().min(0),
  index: z.int().min(0),
  title: z.string().optional(),
  meta: SectionMetaSchema.optional(),
  hash: hashString,
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
  content: z.array(ContentBlockSchema).optional(),
  get children() {
    return z.array(DocumentSectionSchema).optional();
  },
});
export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
// Names the recursive $defs entry in the generated JSON schema.
z.globalRegistry.add(DocumentSectionSchema, { id: 'document_section' });

export const FileChunkSchema = z.object({
  index: z.int().min(0),
  uri: z.string().min(1),
  hash: hashString,
  size_bytes: z.int().min(0),
  chunk_meta: z.string(),
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
});
export type FileChunk = z.infer<typeof FileChunkSchema>;

export const DigestFileSchema = z.object({
  name: z.string().min(1),
  uri: z.string().min(1),
  hash: hashString,
  mime_type: z.string().min(1),
  size_bytes: z.int().min(0),
  chunks: z.array(FileChunkSchema).optional(),
});
export type DigestFile = z.infer<typeof DigestFileSchema>;

// Adapter write capability (design §5.4a).
export const WritableCapabilitySchema = z.union([
  z.literal('full'), z.literal('none'), z.array(BlockTypeSchema),
]);
export type WritableCapability = z.infer<typeof WritableCapabilitySchema>;

export const DigestDocumentSchema = z.object({
  name: z.string().min(1),
  summary: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  writable: WritableCapabilitySchema,
  // The source Digest's file.hash at conversion (design §2.6) — divergence
  // against the live source signals source_changed.
  source_file_hash: hashString,
  // The root section.
  sections: DocumentSectionSchema,
});
export type DigestDocument = z.infer<typeof DigestDocumentSchema>;

export const ArtefactRelationSchema = z.object({
  id: shortId,
  type: z.enum(['converted_from', 'converted_to']),
});
export type ArtefactRelation = z.infer<typeof ArtefactRelationSchema>;

// One Digest per file on disk ("B as drawn", design §2.2): file is always
// present (every artefact IS a file); document rides the master md's own
// record only.
export const DigestSchema = z.object({
  id: shortId,
  type: ArtefactTypeSchema,
  origin_uri: z.string().min(1),
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
  file: DigestFileSchema,
  document: DigestDocumentSchema.optional(),
  related: z.array(ArtefactRelationSchema).optional(),
})
  .refine((d) => d.type !== 'document' || d.document !== undefined, {
    message: 'document artefacts must carry the document branch',
    path: ['document'],
  })
  .refine((d) => d.type !== 'file' || d.document === undefined, {
    message: 'file artefacts must not carry a document branch',
    path: ['document'],
  });
export type Digest = z.infer<typeof DigestSchema>;

// Web-cache fields live on file-type index entries only (design §2.1):
// document entries are locally born and carry no web cache state.
export const WEB_CACHE_KEYS = [
  'origin_etag', 'fresh_until', 'last_modified', 'last_fetched',
] as const;

export const ArtefactIndexEntrySchema = z.object({
  artefact_id: shortId,
  artefact_type: ArtefactTypeSchema,
  origin_uri: z.string().min(1),
  origin_etag: z.string().optional(),
  fresh_until: isoDateTime.optional(),
  // Verbatim HTTP Last-Modified value (an HTTP-date, not ISO 8601).
  last_modified: z.string().optional(),
  last_fetched: isoDateTime.optional(),
  created_at: isoDateTime,
  updated_at: isoDateTime.optional(),
}).refine(
  (e) => e.artefact_type === 'file'
    || WEB_CACHE_KEYS.every((k) => e[k] === undefined),
  { message: 'document index entries carry no web cache state' },
);
export type ArtefactIndexEntry = z.infer<typeof ArtefactIndexEntrySchema>;

export type IndexCacheFields = Pick<
  ArtefactIndexEntry, (typeof WEB_CACHE_KEYS)[number]
>;

// artefact-index.json is the corpus index: one entry per artefact.
export const ArtefactIndexSchema = z.array(ArtefactIndexEntrySchema);
export type ArtefactIndex = z.infer<typeof ArtefactIndexSchema>;

// Generated JSON schemas, shipped in the publish payload (plan M2). The
// app build writes them to dist/digest.schema.json and
// dist/artefact-index.schema.json.
export function buildDigestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(DigestSchema) as Record<string, unknown>;
}

export function buildArtefactIndexJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ArtefactIndexSchema) as Record<string, unknown>;
}
