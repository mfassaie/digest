import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allConverters } from './registry.js';
import { allFixtureIds, loadFixture } from './fixture.js';
import { runConversion, type RunOutcome } from './runner.js';
import {
  outline, headingsHierarchical,
  fenceCount, tableRowCount, rougeLDetailed, headingTitleF1,
  estimateTokens, ratio,
} from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, '..', 'RESULTS.md');

// Approximate Docker image-size delta in MB per converter (documented
// estimate; refined once the winner is built into the image).
const IMAGE_DELTA_MB: Record<string, number> = {
  'defuddle': 6,
  'readability+turndown': 4,
  'turndown-raw': 3,
  'readability+rehype': 7,
  'rehype-raw': 6,
  'mdream': 5,
  'go-html2md-raw': 5,
  'readability+go-html2md': 9,
};

const WEIGHTS = {
  extraction: 0.25,
  heading: 0.25,
  fidelity: 0.20,
  token: 0.10,
  perf: 0.10,
  image: 0.10,
};

interface PerConverter {
  name: string;
  note: string;
  extracts: boolean;
  extraction: number;
  precision: number;
  recall: number;
  heading: number;
  fidelity: number;
  token: number;
  meanMs: number;
  meanRssMb: number;
  imageMb: number;
  // gates
  robustnessOk: boolean;
  headingGateOk: boolean;
  failures: string[];
  // filled after normalisation
  perf?: number;
  imageScore?: number;
  overall?: number;
  eligible?: boolean;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const converters = allConverters();
  const fixtureIds = allFixtureIds();
  if (fixtureIds.length === 0) {
    throw new Error('no fixtures found under tooling-evals/fixtures');
  }
  const fixtures = fixtureIds.map(loadFixture);
  const docFixtures = new Set(
    fixtures.filter((f) => f.meta.category === 'docs-code').map((f) => f.id),
  );

  const rows: PerConverter[] = [];

  for (const conv of converters) {
    process.stderr.write(`\n=== ${conv.name} ===\n`);
    const extractionScores: number[] = [];
    const precisionScores: number[] = [];
    const recallScores: number[] = [];
    const headingGoldenScores: number[] = [];
    const fidelityScores: number[] = [];
    const tokenScores: number[] = [];
    const msList: number[] = [];
    const rssList: number[] = [];
    const failures: string[] = [];
    let robustnessOk = true;
    let docHierarchicalHits = 0;
    let docCount = 0;
    const structuralHits: number[] = [];

    for (const fx of fixtures) {
      const outcome: RunOutcome = await runConversion(conv.name, fx.id);
      const tag = `${fx.id}`.padEnd(28);
      if (outcome.status !== 'ok') {
        process.stderr.write(`  ${tag} ${outcome.status}\n`);
        failures.push(`${fx.id}: ${outcome.status}`);
        if (fx.meta.category === 'malformed') robustnessOk = false;
        if (docFixtures.has(fx.id)) docCount++;
        structuralHits.push(0);
        continue;
      }
      const md = outcome.markdown ?? '';
      const heads = outline(md);
      const hier = headingsHierarchical(heads);
      structuralHits.push(hier ? 1 : 0);
      if (docFixtures.has(fx.id)) {
        docCount++;
        if (hier) docHierarchicalHits++;
      }
      msList.push(outcome.ms ?? 0);
      rssList.push((outcome.peakRssBytes ?? 0) / (1024 * 1024));

      if (fx.golden) {
        const rg = rougeLDetailed(md, fx.golden);
        precisionScores.push(rg.precision);
        recallScores.push(rg.recall);
        // Weight precision over recall: leaked boilerplate (low
        // precision) is the failure extraction is meant to prevent.
        extractionScores.push(0.6 * rg.precision + 0.4 * rg.recall);
        const gOut = outline(fx.golden);
        const titleF1 = headingTitleF1(heads, gOut);
        const countR = ratio(heads.length, gOut.length);
        headingGoldenScores.push(0.7 * titleF1 + 0.3 * countR);
        const fenceR = ratio(fenceCount(md), fenceCount(fx.golden));
        const tableR = ratio(tableRowCount(md), tableRowCount(fx.golden));
        fidelityScores.push(0.5 * fenceR + 0.5 * tableR);
        tokenScores.push(
          Math.min(1, estimateTokens(fx.golden) / Math.max(
            1, estimateTokens(md),
          )),
        );
      }
      process.stderr.write(
        `  ${tag} ok  ${(outcome.ms ?? 0).toFixed(0)}ms  ` +
        `${heads.length}h ${hier ? 'hier' : 'FLAT'}\n`,
      );
    }

    const goldenHeading = mean(headingGoldenScores);
    const structuralFraction = mean(structuralHits);
    rows.push({
      name: conv.name,
      note: conv.note,
      extracts: conv.extracts,
      extraction: mean(extractionScores),
      precision: mean(precisionScores),
      recall: mean(recallScores),
      heading: 0.6 * goldenHeading + 0.4 * structuralFraction,
      fidelity: mean(fidelityScores),
      token: mean(tokenScores),
      meanMs: mean(msList),
      meanRssMb: mean(rssList),
      imageMb: IMAGE_DELTA_MB[conv.name] ?? 8,
      robustnessOk,
      headingGateOk: docCount === 0 || docHierarchicalHits / docCount >= 0.9,
      failures,
    });
  }

  // Normalise perf and image across converters (lower is better -> 1).
  const msVals = rows.map((r) => r.meanMs);
  const rssVals = rows.map((r) => r.meanRssMb);
  const imgVals = rows.map((r) => r.imageMb);
  const invNorm = (v: number, arr: number[]): number => {
    const lo = Math.min(...arr); const hi = Math.max(...arr);
    if (hi === lo) return 1;
    return 1 - (v - lo) / (hi - lo);
  };
  for (const r of rows) {
    const perf = 0.5 * invNorm(r.meanMs, msVals) +
      0.5 * invNorm(r.meanRssMb, rssVals);
    r.perf = perf;
    r.imageScore = invNorm(r.imageMb, imgVals);
    r.overall =
      WEIGHTS.extraction * r.extraction +
      WEIGHTS.heading * r.heading +
      WEIGHTS.fidelity * r.fidelity +
      WEIGHTS.token * r.token +
      WEIGHTS.perf * perf +
      WEIGHTS.image * r.imageScore;
    // Extraction (stripping nav/ads) is an MVP requirement, so converters
    // that do not extract are baselines only — never an eligible winner.
    r.eligible = r.robustnessOk && r.headingGateOk && r.extracts;
  }

  rows.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  writeResults(rows, fixtures.length);
  process.stderr.write(`\nWrote ${RESULTS}\n`);
}

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

function writeResults(rows: PerConverter[], nFixtures: number): void {
  const winner = rows.find((r) => r.eligible);
  const lines: string[] = [];
  lines.push('# Converter eval results');
  lines.push('');
  lines.push(`Fixtures: ${nFixtures}. Generated by \`pnpm --filter ` +
    '@digest/tooling-evals run all`.');
  lines.push('');
  lines.push('Weights: extraction 25%, heading 25%, fidelity 20%, ' +
    'token 10%, perf 10%, image 10%. Hard gates: zero crashes/timeouts ' +
    'on malformed fixtures; hierarchical headings on >=90% of docs-code ' +
    'fixtures.');
  lines.push('');
  lines.push('| Rank | Converter | Overall | Extract | Heading | ' +
    'Fidelity | Token | Perf | Image | Gates |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    const gateFails = [
      r.robustnessOk ? '' : 'robustness',
      r.headingGateOk ? '' : 'headings',
    ].filter(Boolean);
    const gates = r.eligible ? 'pass'
      : !r.extracts && gateFails.length === 0 ? 'baseline (no extraction)'
        : `FAIL(${gateFails.join(',')})`;
    lines.push(
      `| ${i + 1} | ${r.name} | ${pct(r.overall ?? 0)} | ` +
      `${pct(r.extraction)} | ${pct(r.heading)} | ${pct(r.fidelity)} | ` +
      `${pct(r.token)} | ${pct(r.perf ?? 0)} | ${pct(r.imageScore ?? 0)} | ` +
      `${gates} |`,
    );
  });
  lines.push('');
  lines.push('## Raw metrics');
  lines.push('');
  lines.push('| Converter | precision | recall | mean ms | mean RSS MB | ' +
    'image MB | extracts | note |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${pct(r.precision)} | ${pct(r.recall)} | ` +
      `${r.meanMs.toFixed(0)} | ${r.meanRssMb.toFixed(0)} | ` +
      `${r.imageMb} | ${r.extracts ? 'yes' : 'no'} | ${r.note} |`,
    );
  }
  lines.push('');
  const failing = rows.filter((r) => r.failures.length);
  if (failing.length) {
    lines.push('## Failures');
    lines.push('');
    for (const r of failing) {
      lines.push(`- **${r.name}**: ${r.failures.join('; ')}`);
    }
    lines.push('');
  }
  lines.push('## Verdict');
  lines.push('');
  lines.push(winner
    ? `Winner (highest overall passing gates): **${winner.name}** ` +
      `(${pct(winner.overall ?? 0)}). ${winner.note}.`
    : 'No converter passed the hard gates. Review failures above.');
  lines.push('');
  lines.push('Recorded in ADR-006-converter-choice.md.');
  writeFileSync(RESULTS, lines.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});
