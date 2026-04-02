// Markdown engine domain types: the format-neutral DocumentSection /
// ContentBlock contract (ADR-011, tooling-interface design §2.2 + §5.3).
// Keys are snake_case because these shapes are persisted into digest.json
// verbatim (external surface convention). Positions are UTF-8 byte offsets
// into the master markdown and sit OUTSIDE the hash lock, as do depth,
// index, timestamps and descendants (decisions ledger).

export interface BytePosition {
  start: number; // inclusive UTF-8 byte offset
  end: number; // exclusive UTF-8 byte offset
}

// Section types per design §5.3. `page` and `form` are minted by later
// format adapters (PDF), never by the markdown fold.
export type SectionType =
  | 'root' | 'front-matter' | 'section' | 'page' | 'form';

export type BlockType =
  | 'paragraph' | 'code' | 'diagram' | 'table' | 'image' | 'list'
  | 'quote' | 'footnote' | 'html' | 'break' | 'form-field';

export interface BlockMeta {
  lang?: string; // code/diagram fence language; 'yaml' on front-matter
  callout?: string; // later: Obsidian callouts (§5.3)
  critic?: Record<string, number>; // deferred C2 detection (§5.5)
  field_type?: string; // later: form adapters (§5.4a)
  field_name?: string;
  options?: string[];
  required?: boolean;
}

export interface SectionMeta {
  page_range?: string; // later: PDF page sections
  critic_rollup?: Record<string, number>; // deferred (§5.5)
}

export interface ContentBlock {
  id: string; // minted 22-char base64url guid, sticky (§2.4)
  index: number; // 0..n within the owning section
  type: BlockType;
  value: string; // raw markdown slice; inner YAML on front-matter (§4)
  meta?: BlockMeta;
  hash: string; // sha256 of (type, value, meta) — ledger
  position: BytePosition;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentSection {
  id: string; // minted 22-char base64url guid, sticky (§2.4)
  type: SectionType;
  depth: number; // 0..n from root
  index: number; // order among sibling sections
  title?: string; // heading text; absent on root and front-matter
  meta?: SectionMeta;
  hash: string; // sha256 of (type, title, ordered block hashes) — ledger
  position: BytePosition;
  content?: ContentBlock[]; // ordered typed payloads, NOT part of the tree
  children?: DocumentSection[]; // sections only — homogeneous
  created_at?: string;
  updated_at?: string;
}
