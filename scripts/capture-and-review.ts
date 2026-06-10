// Real-world e2e: drive the production host handlers (fetch /
// _read) against real sites through the live container, capture rendered
// HTML as eval fixtures, and dump get/read output for review.
// Run: npx tsx scripts/capture-and-review.ts
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from
  'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { handleGet, handleRead } from '../src/server.js';
import { realRunner, ensureContainer, CONTAINER } from '../src/docker.js';
import { containerFetch } from '../src/container-client.js';
import { getCacheDir } from '../src/cache.js';
import { extractiveEngine } from '../src/read-engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'eval', 'fixtures');
const reviewPath = join(here, '..', 'eval', 'REAL-E2E-REVIEW.md');

interface Site {
  id: string;
  url: string;
  category: string;
  note: string;
}

// 5 designated e2e sites + 3 extra for eval breadth.
const SITES: Site[] = [
  { id: 'real-mdn-http-headers', category: 'docs-code',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers',
    note: 'MDN docs: deep TOC, tables, inline code, nav/sidebar boilerplate' },
  { id: 'real-wikipedia-http', category: 'tables',
    url: 'https://en.wikipedia.org/wiki/HTTP',
    note: 'Wikipedia: infobox, tables, references, heavy chrome' },
  { id: 'real-k8s-overview', category: 'docs-code',
    url: 'https://kubernetes.io/docs/concepts/overview/',
    note: 'Kubernetes docs: nav, sidebar, content' },
  { id: 'real-spa-quotes', category: 'spa',
    url: 'https://quotes.toscrape.com/js/',
    note: 'JS-rendered SPA: content only exists after hydration' },
  { id: 'real-stackoverflow', category: 'news-boilerplate',
    url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
    note: 'Stack Overflow Q&A: very heavy boilerplate (sidebars, related, ads)' },
  { id: 'real-python-json', category: 'docs-code',
    url: 'https://docs.python.org/3/library/json.html',
    note: 'Python docs: code blocks, definition lists, deep sections' },
  { id: 'real-mdn-flex', category: 'docs-code',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/flex',
    note: 'MDN CSS reference: syntax blocks, examples' },
  { id: 'real-rust-blog', category: 'news-boilerplate',
    url: 'https://blog.rust-lang.org/',
    note: 'Blog index: article list with site chrome' },
];

const E2E_REVIEW = new Set([
  'real-mdn-http-headers', 'real-wikipedia-http', 'real-k8s-overview',
  'real-spa-quotes', 'real-stackoverflow',
]);

const cacheRoot = mkdtempSync(join(tmpdir(), 'falk-real-'));
const deps = {
  runner: realRunner, cacheRoot,
  ensureFn: ensureContainer, fetchFn: containerFetch,
  engine: extractiveEngine,
};

function textOf(r: { isError?: boolean; content: { text: string }[] }): string {
  return (r.isError ? '[isError] ' : '') + r.content[0].text;
}

async function main(): Promise<void> {
  const review: string[] = ['# Real-world e2e review', ''];
  for (const site of SITES) {
    process.stderr.write(`\n=== ${site.id} ===\n`);
    let getText = '';
    try {
      const get = await handleGet(
        { uri: site.url, timeout_seconds: 45 }, deps,
      );
      getText = textOf(get);
    } catch (err) {
      getText = `THREW: ${err instanceof Error ? err.message : String(err)}`;
    }
    process.stderr.write(getText.split('\n').slice(0, 4).join('\n') + '\n');

    // Save rendered HTML as an eval fixture.
    try {
      const dir = getCacheDir(
        site.url.replace(/^http:/, 'https:'), cacheRoot,
      );
      const raw = readFileSync(join(dir, 'raw.html'), 'utf8');
      const fdir = join(fixturesDir, site.id);
      mkdirSync(fdir, { recursive: true });
      writeFileSync(join(fdir, 'input.html'), raw);
      writeFileSync(join(fdir, 'fixture.json'), JSON.stringify({
        url: site.url, category: site.category, notes: site.note,
        capturedAt: '2026-06-10', real: true,
      }, null, 2) + '\n');
      process.stderr.write(`  saved fixture (${raw.length}b)\n`);
    } catch (err) {
      process.stderr.write(`  no raw.html: ${
        err instanceof Error ? err.message : String(err)}\n`);
    }

    if (!E2E_REVIEW.has(site.id)) continue;

    const sections = textOf(await handleRead(
      { uri: site.url, mode: 'sections' }, deps));
    const summary = textOf(await handleRead(
      { uri: site.url, mode: 'summary' }, deps));
    const keywords = textOf(await handleRead(
      { uri: site.url, mode: 'keywords' }, deps));

    review.push(`## ${site.id}`, '', `${site.note}`, '',
      '### get', '```', getText.slice(0, 1400), '```', '',
      '### read sections', '```',
      sections.split('\n').slice(0, 40).join('\n'), '```', '',
      '### read summary', '```', summary.slice(0, 1200), '```', '',
      '### read keywords', '```', keywords.slice(0, 400), '```', '');
  }

  writeFileSync(reviewPath, review.join('\n') + '\n');
  process.stderr.write(`\nWrote ${reviewPath}\n`);
  await realRunner.exec('docker', ['rm', '-f', CONTAINER], 30_000);
  rmSync(cacheRoot, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); process.exit(1); });
