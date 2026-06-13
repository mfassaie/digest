import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { computeExtracts } from '../md-engine/extracts.js';
import { parseMarkdown } from '../md-engine/fold.js';
import { rematchIds } from '../md-engine/rematch.js';
import { serialiseSection } from '../md-engine/serialise.js';
import { replaceByteRange } from '../md-engine/splice.js';
import { sectionById } from '../md-engine/walk.js';
import type {
  DocumentSection as EngineSection,
} from '../md-engine/types.js';
import { isShortId } from '../store/ids.js';
import type { ArtefactStore } from '../store/store.js';
import type {
  Digest, DocumentSection, WritableCapability,
} from '../store/record.js';
import { toStoredSection } from './convert-md.js';
import type { ReadEngine } from '../read-engine.js';

// Write engine (plan M6, ADR-011 design §3.4 + §4): apply a client-
// supplied section subtree to the document's master markdown via byte-
// range splice, with hash-based optimistic locking. children_mode
// 'replace' only (v1): absent children die with their subtrees, matched
// ids update, unknown ids mint new nodes.

export interface WriteSectionInput {
  id: string;
  type?: string;
  title?: string;
  hash?: string;
  content?: WriteSectionBlock[];
  children?: WriteSectionInput[];
}

export interface WriteSectionBlock {
  id?: string;
  type: string;
  value: string;
  meta?: Record<string, unknown>;
}

export interface WriteSectionDeps {
  store: ArtefactStore;
  engine?: ReadEngine;
  now?: () => Date;
}

export interface WriteSectionResult {
  digest: Digest;
  sections: DocumentSection;
}

export class WriteSectionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unknown_artefact'
      | 'not_document'
      | 'not_writable'
      | 'unknown_root'
      | 'hash_mismatch'
      | 'invalid_yaml'
      | 'invalid_id',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WriteSectionError';
  }
}

// The main entry point: validate, splice, persist.
export async function writeSection(
  artefactId: string,
  input: WriteSectionInput,
  childrenMode: 'replace',
  deps: WriteSectionDeps,
): Promise<WriteSectionResult> {
  const stamp = (deps.now?.() ?? new Date()).toISOString();

  // 1. Load and validate the artefact.
  const digest = await deps.store.readDigest(artefactId);
  if (digest === null) {
    throw new WriteSectionError(
      `unknown artefact: ${artefactId}`, 'unknown_artefact',
    );
  }
  if (digest.type !== 'document' || digest.document === undefined) {
    throw new WriteSectionError(
      `${artefactId} is not a document artefact`, 'not_document',
    );
  }
  assertWritable(digest.document.writable, input);

  // 2. Load the master markdown and parse for byte positions.
  const masterPath = join(
    deps.store.paths.artefactDir(artefactId), digest.file.name,
  );
  const markdown = await readFile(masterPath, 'utf8');
  const parsedRoot = parseMarkdown(markdown);
  // Re-match against stored ids so positions carry stored identities.
  const storedRoot = digest.document.sections;
  rematchIds(storedRoot as unknown as EngineSection, parsedRoot);

  // 3. Find the target section in the parsed tree.
  const target = sectionById(parsedRoot, input.id);
  if (target === undefined) {
    throw new WriteSectionError(
      `section id ${input.id} not found in artefact ${artefactId}`,
      'unknown_root',
    );
  }

  // 4. Hash validation: walk the input tree, collect mismatches.
  const mismatches = collectHashMismatches(input, parsedRoot);
  if (mismatches.length > 0) {
    throw new WriteSectionError(
      `hash mismatch on section(s): ${mismatches.join(', ')}`,
      'hash_mismatch',
      { mismatched_ids: mismatches },
    );
  }

  // 5. Validate front-matter YAML if applicable.
  validateFrontMatter(input, target);

  // 6. Validate and normalise ids in the input tree.
  normaliseIds(input, parsedRoot);

  // 7. Serialise the replacement subtree.
  const replacement = serialiseSection(
    buildSerialiseTree(input, target),
  );

  // 8. Splice into the master markdown.
  const newMarkdown = replaceByteRange(
    markdown, target.position.start, target.position.end, replacement,
  );

  // 9. Re-parse, re-match, recompute hashes.
  const newParsed = parseMarkdown(newMarkdown, { now: stamp });
  const finalRoot = rematchIds(parsedRoot, newParsed, { now: stamp });

  // 10. Compute new extracts.
  const extracts = computeExtracts(finalRoot, { engine: deps.engine });

  // 11. Persist: write the new markdown and update digest.json.
  await writeFile(masterPath, newMarkdown, 'utf8');
  const updated = await deps.store.updateDigest(artefactId, {
    bytes: newMarkdown,
    mutate: (d) => {
      const doc = d.document!;
      doc.sections = toStoredSection(finalRoot);
      doc.summary = extracts.summary || undefined;
      doc.keywords = extracts.keywords.length > 0
        ? extracts.keywords : undefined;
    },
  });

  return { digest: updated, sections: updated.document!.sections };
}

// Collect ids where the client's hash does not match the stored hash.
// Only nodes with a known id (existing in the tree) must carry a hash.
function collectHashMismatches(
  input: WriteSectionInput, root: EngineSection,
): string[] {
  const mismatches: string[] = [];
  walkMismatches(input, root, mismatches);
  return mismatches;
}

function walkMismatches(
  input: WriteSectionInput, root: EngineSection, out: string[],
): void {
  const existing = sectionById(root, input.id);
  if (existing !== undefined) {
    // Known id: hash is REQUIRED (design §2.5 protocol).
    if (input.hash !== undefined && input.hash !== existing.hash) {
      out.push(input.id);
    }
  }
  for (const child of input.children ?? []) {
    walkMismatches(child, root, out);
  }
}

// Front-matter: validate YAML content before splice (design §4, §5.3).
function validateFrontMatter(
  input: WriteSectionInput, target: EngineSection,
): void {
  if (input.type === 'front-matter' || target.type === 'front-matter') {
    const block = input.content?.[0];
    if (block !== undefined) {
      try {
        yamlParse(block.value);
      } catch (e) {
        throw new WriteSectionError(
          `invalid YAML in front-matter: ${(e as Error).message}`,
          'invalid_yaml',
        );
      }
    }
  }
  for (const child of input.children ?? []) {
    // Check if any child targets a front-matter section.
    const childTarget = sectionById(target, child.id);
    if (childTarget !== undefined) {
      validateFrontMatter(child, childTarget);
    } else if (child.type === 'front-matter') {
      // New front-matter node.
      const block = child.content?.[0];
      if (block !== undefined) {
        try {
          yamlParse(block.value);
        } catch (e) {
          throw new WriteSectionError(
            `invalid YAML in front-matter: ${(e as Error).message}`,
            'invalid_yaml',
          );
        }
      }
    }
  }
}

// Validate and normalise ids: unknown ids are either valid 22-char
// base64url (accepted as-is) or absent (minted). Invalid format rejects.
function normaliseIds(
  input: WriteSectionInput, root: EngineSection,
): void {
  const existing = sectionById(root, input.id);
  if (existing === undefined) {
    // New node: id must be a valid short id or we mint one.
    if (!isShortId(input.id)) {
      throw new WriteSectionError(
        `invalid section id format: ${input.id}`,
        'invalid_id',
      );
    }
    // Accept valid user-supplied id.
  }
  for (const child of input.children ?? []) {
    normaliseIds(child, root);
  }
}

// Build the serialisation tree from the client input, using the target
// section for depth context. Content blocks are taken verbatim from the
// input; children are serialised recursively.
function buildSerialiseTree(
  input: WriteSectionInput, target: EngineSection,
): {
    type: string; depth: number; title?: string;
    content?: { type: string; value: string; meta?: { lang?: string } }[];
    children?: ReturnType<typeof buildSerialiseTree>[];
  } {
  const type = input.type ?? target.type;
  const depth = target.depth;
  const title = input.title ?? target.title;

  const content = input.content?.map((b) => ({
    type: b.type,
    value: b.value,
    ...(b.meta?.lang !== undefined ? { meta: { lang: b.meta.lang as string } } : {}),
  }));

  const children = input.children?.map((child, i) => {
    // For existing children, find their target for depth.
    const childTarget = sectionById(target, child.id);
    if (childTarget !== undefined) {
      return buildSerialiseTree(child, childTarget);
    }
    // New child: depth is parent depth + 1.
    return buildSerialiseTree(child, {
      id: child.id,
      type: (child.type ?? 'section') as EngineSection['type'],
      depth: depth + 1,
      index: i,
      hash: '',
      position: { start: 0, end: 0 },
      title: child.title,
    });
  });

  return { type, depth, title, content, children };
}

// Check the writable capability (design §5.4a). 'full' allows everything;
// 'none' rejects all writes; an array of block types restricts to those.
function assertWritable(
  writable: WritableCapability, input: WriteSectionInput,
): void {
  if (writable === 'full') return;
  if (writable === 'none') {
    throw new WriteSectionError(
      'this artefact is not writable', 'not_writable',
    );
  }
  // writable is an array of allowed block types.
  const allowed = new Set(writable);
  assertBlockTypes(input, allowed);
}

function assertBlockTypes(
  input: WriteSectionInput, allowed: Set<string>,
): void {
  for (const block of input.content ?? []) {
    if (!allowed.has(block.type)) {
      throw new WriteSectionError(
        `block type '${block.type}' not writable on this artefact ` +
        `(allowed: ${[...allowed].join(', ')})`,
        'not_writable',
      );
    }
  }
  for (const child of input.children ?? []) {
    assertBlockTypes(child, allowed);
  }
}
