import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { converterByName } from './registry.js';
import { loadFixture } from './fixture.js';

// Invoked as: tsx worker.ts <converterName> <fixtureId> <outFile>
// Runs one conversion in isolation so the parent can enforce a hard
// timeout and the process crashing cannot take down the whole eval.
async function main(): Promise<void> {
  const [, , name, fixtureId, outFile] = process.argv;
  const converter = converterByName(name);
  if (!converter) throw new Error(`unknown converter: ${name}`);
  const fixture = loadFixture(fixtureId);

  let peakRss = process.memoryUsage().rss;
  const sample = (): void => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  };
  const sampler = setInterval(sample, 5);

  const t0 = performance.now();
  try {
    const result = await converter.convert(fixture.html, fixture.meta.url);
    const ms = performance.now() - t0;
    sample();
    clearInterval(sampler);
    writeFileSync(outFile, JSON.stringify({
      ok: true,
      ms,
      peakRssBytes: peakRss,
      markdown: result.markdown,
      title: result.title ?? null,
    }));
  } catch (err) {
    clearInterval(sampler);
    writeFileSync(outFile, JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});
