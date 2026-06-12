import type { Code, Heading, Paragraph, RootContent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { blockHash, sectionHash } from './hash.js';
import { mintId } from './ids.js';
import type {
  BlockMeta, BlockType, ContentBlock, DocumentSection,
} from './types.js';

// The deterministic mdast -> DocumentSection fold (design §5.2/§5.3,
// ADR-011). remark owns syntax correctness and positions — that is what
// keeps `#` inside code fences, setext headings and html blocks from
// mis-firing as sections (the write-corrupting failure mode of naive
// heading scans). Only TOP-LEVEL headings open sections; headings nested
// inside blockquotes/lists/html stay opaque inside their block.

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .freeze();

export interface ParseOptions {
  // ISO timestamp stamped as created_at on every minted node. Leave unset
  // when rematchIds will stamp new nodes instead.
  now?: string;
}

// Parse + fold: returns the root DocumentSection with freshly minted ids,
// computed hashes and UTF-8 byte positions per node (splice depends on
// them). Callers needing sticky ids pass the result through rematchIds.
export function parseMarkdown(
  markdown: string, opts: ParseOptions = {},
): DocumentSection {
  const tree = processor.parse(markdown);
  const toBytes = byteOffsetMapper(markdown);
  const totalBytes = Buffer.byteLength(markdown, 'utf8');
  const created = opts.now;

  const root: DocumentSection = {
    id: mintId(), type: 'root', depth: 0, index: 0, hash: '',
    position: { start: 0, end: totalBytes },
    ...(created !== undefined ? { created_at: created } : {}),
  };

  // Open-section stack; heading level drives nesting (root = level 0), so
  // skipped levels (h1 -> h3) still nest one tree depth down.
  const stack: Array<{ section: DocumentSection; level: number }> = [
    { section: root, level: 0 },
  ];

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      // remark-frontmatter only matches at document start. The block
      // carries the inner YAML as value (§4: validated and re-fenced on
      // write); positions span the fences for splice.
      (root.children ??= []).push(
        frontMatterSection(node.value, offsetsOf(node), toBytes, created),
      );
      continue;
    }
    if (node.type === 'heading') {
      while (stack.length > 1 && stack[stack.length - 1]!.level >= node.depth) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]!.section;
      const { start, end } = offsetsOf(node);
      const section: DocumentSection = {
        id: mintId(), type: 'section', depth: parent.depth + 1,
        index: (parent.children ??= []).length,
        title: inlineText(node), hash: '',
        position: { start: toBytes(start), end: toBytes(end) },
        ...(created !== undefined ? { created_at: created } : {}),
      };
      parent.children!.push(section);
      stack.push({ section, level: node.depth });
      continue;
    }
    appendBlock(stack[stack.length - 1]!.section, node, markdown, toBytes,
      created);
  }

  finalise(root, totalBytes);
  return root;
}

function frontMatterSection(
  yamlValue: string, offsets: { start: number; end: number },
  toBytes: (cu: number) => number, created: string | undefined,
): DocumentSection {
  const position = { start: toBytes(offsets.start), end: toBytes(offsets.end) };
  const meta: BlockMeta = { lang: 'yaml' };
  return {
    id: mintId(), type: 'front-matter', depth: 1, index: 0, hash: '',
    position: { ...position },
    content: [{
      id: mintId(), index: 0, type: 'code', value: yamlValue, meta,
      hash: blockHash('code', yamlValue, meta), position: { ...position },
      ...(created !== undefined ? { created_at: created } : {}),
    }],
    ...(created !== undefined ? { created_at: created } : {}),
  };
}

function appendBlock(
  section: DocumentSection, node: RootContent, markdown: string,
  toBytes: (cu: number) => number, created: string | undefined,
): void {
  const { start, end } = offsetsOf(node);
  const { type, meta } = blockTypeOf(node);
  const value = markdown.slice(start, end); // raw source, never re-serialised
  const content = (section.content ??= []);
  content.push({
    id: mintId(), index: content.length, type, value,
    ...(meta !== undefined ? { meta } : {}),
    hash: blockHash(type, value, meta),
    position: { start: toBytes(start), end: toBytes(end) },
    ...(created !== undefined ? { created_at: created } : {}),
  });
}

// Block typing per the §5.3 vocabulary. Unlisted flow nodes (e.g. link
// reference definitions) fall back to paragraph: the value is the raw
// slice either way, so fidelity is positional, not type-driven.
const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'dot']);

function blockTypeOf(
  node: RootContent,
): { type: BlockType; meta?: BlockMeta } {
  switch (node.type) {
    case 'code': return classifyCode(node);
    case 'table': return { type: 'table' };
    case 'list': return { type: 'list' };
    case 'blockquote': return { type: 'quote' };
    case 'html': return { type: 'html' };
    case 'thematicBreak': return { type: 'break' };
    case 'footnoteDefinition': return { type: 'footnote' };
    case 'paragraph':
      return { type: isImageOnly(node) ? 'image' : 'paragraph' };
    default: return { type: 'paragraph' };
  }
}

function classifyCode(node: Code): { type: BlockType; meta?: BlockMeta } {
  const lang = node.lang ?? undefined;
  const diagram = lang !== undefined && DIAGRAM_LANGS.has(lang.toLowerCase());
  return {
    type: diagram ? 'diagram' : 'code',
    ...(lang !== undefined ? { meta: { lang } } : {}),
  };
}

function isImageOnly(node: Paragraph): boolean {
  return node.children.length === 1
    && (node.children[0]!.type === 'image'
      || node.children[0]!.type === 'imageReference');
}

// Plain text of a heading (mdast-util-to-string semantics: value, then
// alt, then children).
interface TextishNode {
  value?: unknown;
  alt?: unknown;
  children?: TextishNode[];
}

function inlineText(node: TextishNode | Heading): string {
  const n = node as TextishNode;
  if (typeof n.value === 'string') return n.value;
  if (typeof n.alt === 'string') return n.alt;
  return (n.children ?? []).map(inlineText).join('');
}

// Bottom-up: extend each section's end over its blocks and children, then
// compute hashes (blocks first by construction, sections here).
function finalise(section: DocumentSection, forcedEnd?: number): void {
  for (const child of section.children ?? []) finalise(child);
  if (forcedEnd !== undefined) {
    section.position.end = forcedEnd;
  } else {
    let end = section.position.end;
    for (const b of section.content ?? []) end = Math.max(end, b.position.end);
    for (const c of section.children ?? []) {
      end = Math.max(end, c.position.end);
    }
    section.position.end = end;
  }
  section.hash = sectionHash(
    section.type, section.title, (section.content ?? []).map((b) => b.hash),
  );
}

// The M3 spike assertion carried into production: unist positions with
// offsets are load-bearing for splice, so their absence is a loud error,
// never a silent skip.
function offsetsOf(
  node: { type: string; position?: { start: { offset?: number };
    end: { offset?: number } } | undefined },
): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error(
      `md-engine: mdast '${node.type}' node has no position offsets — `
      + 'spike assumption violated, do not splice against this parse',
    );
  }
  return { start, end };
}

// mdast offsets are UTF-16 code-unit indices; persisted positions are
// UTF-8 byte offsets (splice and any non-JS consumer operate on bytes).
// ASCII documents take the identity fast path.
function byteOffsetMapper(source: string): (codeUnit: number) => number {
  if (Buffer.byteLength(source, 'utf8') === source.length) {
    return (cu) => cu;
  }
  const map = new Uint32Array(source.length + 1);
  let bytes = 0;
  let i = 0;
  while (i < source.length) {
    map[i] = bytes;
    const code = source.codePointAt(i)!;
    if (code <= 0x7f) {
      bytes += 1; i += 1;
    } else if (code <= 0x7ff) {
      bytes += 2; i += 1;
    } else if (code <= 0xffff) {
      bytes += 3; i += 1;
    } else {
      map[i + 1] = bytes; // interior of a surrogate pair clamps to its start
      bytes += 4; i += 2;
    }
  }
  map[source.length] = bytes;
  return (cu) => map[cu]!;
}
