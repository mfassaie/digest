import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allConverters } from './registry.js';
import { allFixtureIds, loadFixture } from './fixture.js';
import { runConversion } from './runner.js';
import {
  outline, headingsHierarchical, estimateTokens, tokenize,
} from './score.js';
import { extractMainContent } from './extract.js';

// Real-corpus eval. No hand goldens (they would bias toward one extractor),
// so we score on golden-free signals that target the open question —
// boilerplate leakage — plus heading structure and content retention. The
// neutral size reference is Readability (not part of the defuddle pipeline).
const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, '..', 'RESULTS-real.md');

// Boilerplate markers: chrome that good extraction should strip.
const BOILER = [
  /\bcookie(s)?\b/i, /\bsubscribe\b/i, /\bnewsletter\b/i, /\bsign in\b/i,
  /\blog ?in\b/i, /\badvertisement\b/i, /skip to (main )?content/i,
  /all rights reserved/i, /©/, /\bprivacy policy\b/i, /\bterms of (use|service)\b/i,
  /related (articles|questions|posts)/i, /share this/i, /\bfollow us\b/i,
  /\btrending\b/i, /accept (all )?cookies/i,
];

function leakagePer1k(markdown: string): number {
  const hits = BOILER.reduce(
    (n, re) => n + (markdown.match(new RegExp(re, 'gi'))?.length ?? 0), 0,
  );
  const toks = Math.max(1, tokenize(markdown).length);
  return (hits / toks) * 1000;
}

interface Row {
  name: string;
  extracts: boolean;
  hierFraction: number;
  meanHeadings: number;
  meanLeakage: number;     // markers per 1k tokens (lower better)
  meanRetention: number;   // output tokens / readability tokens
  meanMs: number;
  failures: string[];
  score?: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

async function main(): Promise<void> {
  const ids = allFixtureIds().filter((id) => id.startsWith('real-'));
  if (ids.length === 0) {
    throw new Error('no real-* fixtures; run scripts/capture-and-review.ts');
  }
  const fixtures = ids.map(loadFixture);
  // Readability reference token count per fixture (neutral size oracle).
  const refTokens = new Map<string, number>();
  for (const fx of fixtures) {
    const { html } = extractMainContent(fx.html, fx.meta.url);
    refTokens.set(fx.id, estimateTokens(html.replace(/<[^>]+>/g, ' ')));
  }

  const rows: Row[] = [];
  for (const conv of allConverters()) {
    process.stderr.write(`\n=== ${conv.name} ===\n`);
    const hier: number[] = [];
    const heads: number[] = [];
    const leak: number[] = [];
    const retention: number[] = [];
    const ms: number[] = [];
    const failures: string[] = [];

    for (const fx of fixtures) {
      const out = await runConversion(conv.name, fx.id);
      if (out.status !== 'ok' || !out.markdown) {
        failures.push(`${fx.id}:${out.status}`);
        process.stderr.write(`  ${fx.id.padEnd(26)} ${out.status}\n`);
        continue;
      }
      const md = out.markdown;
      const o = outline(md);
      hier.push(headingsHierarchical(o) ? 1 : 0);
      heads.push(o.length);
      leak.push(leakagePer1k(md));
      const ref = refTokens.get(fx.id) ?? 1;
      retention.push(estimateTokens(md) / Math.max(1, ref));
      ms.push(out.ms ?? 0);
      process.stderr.write(
        `  ${fx.id.padEnd(26)} ${o.length}h ` +
        `leak=${leakagePer1k(md).toFixed(1)} ` +
        `ret=${(estimateTokens(md) / Math.max(1, ref)).toFixed(2)}\n`,
      );
    }
    rows.push({
      name: conv.name, extracts: conv.extracts,
      hierFraction: mean(hier), meanHeadings: mean(heads),
      meanLeakage: mean(leak), meanRetention: mean(retention),
      meanMs: mean(ms), failures,
    });
  }

  // Composite: heading structure 35%, low leakage 40% (the open question),
  // healthy retention 25% (penalise both dropped content and bloat).
  const maxLeak = Math.max(...rows.map((r) => r.meanLeakage), 0.001);
  for (const r of rows) {
    const leakScore = 1 - clamp01(r.meanLeakage / maxLeak);
    // retention sweet spot ~0.4..1.5 of readability size
    const ret = r.meanRetention;
    const retScore = ret < 0.4 ? clamp01(ret / 0.4)
      : ret <= 1.5 ? 1 : clamp01(1 - (ret - 1.5) / 3);
    r.score = 0.35 * r.hierFraction + 0.40 * leakScore + 0.25 * retScore;
  }
  rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  writeResults(rows, fixtures.length);
  process.stderr.write(`\nWrote ${RESULTS}\n`);
}

function pct(x: number): string { return (x * 100).toFixed(0); }

function writeResults(rows: Row[], n: number): void {
  const lines: string[] = [
    '# Real-corpus converter eval', '',
    `${n} real captured pages (rendered HTML from the live container). ` +
    'No hand goldens — golden-free metrics targeting the open question ' +
    '(boilerplate leakage) plus heading structure and content retention. ' +
    'Readability is the neutral size reference.', '',
    '| Rank | Converter | Score | Hier% | Headings | Leak/1k | Retention | ms | extracts |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.name} | ${pct(r.score ?? 0)} | ` +
      `${pct(r.hierFraction)} | ${r.meanHeadings.toFixed(0)} | ` +
      `${r.meanLeakage.toFixed(1)} | ${r.meanRetention.toFixed(2)} | ` +
      `${r.meanMs.toFixed(0)} | ${r.extracts ? 'yes' : 'no'} |`,
    );
  });
  lines.push('', 'Leak/1k = boilerplate markers per 1000 tokens (lower is ' +
    'better — the precision signal). Retention = output size / Readability ' +
    'extraction (≈0.4–1.5 is healthy; lower drops content, higher leaks).', '');
  const eligible = rows.filter((r) => r.extracts);
  const def = rows.find((r) => r.name === 'defuddle');
  const best = eligible[0];
  lines.push('## Verdict', '');
  if (def && best) {
    lines.push(
      `Defuddle: leak ${def.meanLeakage.toFixed(1)}/1k, ` +
      `hier ${pct(def.hierFraction)}%, retention ${def.meanRetention.toFixed(2)}, ` +
      `rank ${rows.indexOf(def) + 1}/${rows.length}.`,
      '', `Best eligible (extracting) converter: **${best.name}** ` +
      `(score ${pct(best.score ?? 0)}).`,
    );
  }
  const failing = rows.filter((r) => r.failures.length);
  if (failing.length) {
    lines.push('', '## Failures');
    for (const r of failing) lines.push(`- ${r.name}: ${r.failures.join(', ')}`);
  }
  writeFileSync(RESULTS, lines.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});
