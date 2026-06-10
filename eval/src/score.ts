// Pure scoring helpers. Aggregation and weighting live in run-all.ts.

export interface Heading {
  level: number;
  text: string;
}

const TOKEN_CAP = 4000;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Heading outline, skipping fenced code blocks.
export function outline(markdown: string): Heading[] {
  const heads: Heading[] = [];
  let inFence = false;
  let fenceMarker = '';
  for (const line of markdown.split('\n')) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) { inFence = true; fenceMarker = fence[1][0]; }
      else if (fence[1][0] === fenceMarker) { inFence = false; }
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ level: m[1].length, text: m[2].trim() });
  }
  return heads;
}

// True if no heading jumps more than one level deeper than its predecessor.
export function headingsHierarchical(heads: Heading[]): boolean {
  if (heads.length === 0) return false;
  let prev = heads[0].level;
  for (const h of heads.slice(1)) {
    if (h.level > prev + 1) return false;
    prev = h.level;
  }
  return true;
}

export function fenceCount(markdown: string): number {
  const matches = markdown.match(/^\s*(```+|~~~+)/gm) ?? [];
  return Math.floor(matches.length / 2);
}

export function tableRowCount(markdown: string): number {
  return (markdown.match(/^\s*\|.+\|\s*$/gm) ?? []).length;
}

// LCS length over capped token arrays (bounds O(n*m) cost).
function lcsLength(a: string[], b: string[]): number {
  const x = a.slice(0, TOKEN_CAP);
  const y = b.slice(0, TOKEN_CAP);
  const dp = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j];
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[y.length];
}

export interface RougeScore {
  precision: number;
  recall: number;
  f1: number;
}

// ROUGE-L precision/recall/F1 between candidate and reference text.
// Low precision = boilerplate leaked in (poor extraction); low recall =
// main content dropped.
export function rougeLDetailed(
  candidate: string, reference: string,
): RougeScore {
  const c = tokenize(candidate);
  const r = tokenize(reference);
  if (c.length === 0 || r.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }
  const lcs = lcsLength(c, r);
  const precision = lcs / Math.min(c.length, TOKEN_CAP);
  const recall = lcs / Math.min(r.length, TOKEN_CAP);
  const f1 = precision + recall === 0
    ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function rougeL(candidate: string, reference: string): number {
  return rougeLDetailed(candidate, reference).f1;
}

function normSet(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = it.toLowerCase().trim();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// Multiset F1 over heading titles.
export function headingTitleF1(
  candidate: Heading[], golden: Heading[],
): number {
  if (candidate.length === 0 && golden.length === 0) return 1;
  if (candidate.length === 0 || golden.length === 0) return 0;
  const c = normSet(candidate.map((h) => h.text));
  const g = normSet(golden.map((h) => h.text));
  let overlap = 0;
  for (const [k, cn] of c) {
    const gn = g.get(k) ?? 0;
    overlap += Math.min(cn, gn);
  }
  const precision = overlap / candidate.length;
  const recall = overlap / golden.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function ratio(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const hi = Math.max(a, b);
  if (hi === 0) return 1;
  return Math.min(a, b) / hi;
}
