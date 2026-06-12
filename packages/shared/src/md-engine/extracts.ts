import { extractiveEngine, type ReadEngine } from '../read-engine.js';
import type { DocumentSection } from './types.js';

// Document extracts (summary/keywords) via the existing extractive read
// engine over concatenated block values in document order (plan M3,
// design §7.4). Front-matter blocks are skipped: YAML keys are metadata,
// not prose, and would pollute keyword frequencies.

export interface Extracts {
  summary: string;
  keywords: string[];
}

export interface ExtractsOptions {
  engine?: ReadEngine;
  summarySentences?: number; // defaults match the previous read tool modes
  keywordCount?: number;
}

export function computeExtracts(
  root: DocumentSection, opts: ExtractsOptions = {},
): Extracts {
  const {
    engine = extractiveEngine, summarySentences = 5, keywordCount = 12,
  } = opts;
  const parts: string[] = [];
  collect(root, parts);
  const text = parts.join('\n\n');
  return {
    summary: engine.summarise(text, summarySentences),
    keywords: engine.keywords(text, keywordCount),
  };
}

function collect(section: DocumentSection, out: string[]): void {
  if (section.type === 'front-matter') return;
  for (const block of section.content ?? []) out.push(block.value);
  for (const child of section.children ?? []) collect(child, out);
}
