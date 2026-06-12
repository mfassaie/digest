// Real-world fixture capture: drive the in-container fetch service
// directly against real sites, capture rendered HTML as eval fixtures,
// and dump outline/summary/keyword output for review. (The MCP tool
// surface is md-only until M9, so capture talks to the container client,
// not the tools.) Run: npx tsx packages/tooling-evals/capture.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  realRunner, ensureContainer, containerFetch, CONTAINER,
} from '@digest/docker';
import {
  extractiveEngine, formatOutline, type ContainerFetchResponse,
} from '@digest/shared';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const reviewPath = join(here, 'REAL-E2E-REVIEW.md');

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

function summaryLine(res: ContainerFetchResponse): string {
  if (res.outcome !== 'fetched') return `outcome: ${res.outcome}`;
  return [
    `outcome: fetched ${res.status}`,
    `type: ${res.contentType}`,
    `title: ${res.meta.title ?? '(none)'}`,
    `sections: ${res.sections.length}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const { baseUrl } = await ensureContainer(realRunner, {});
  const review: string[] = ['# Real-world e2e review', ''];
  for (const site of SITES) {
    process.stderr.write(`\n=== ${site.id} ===\n`);
    let res: ContainerFetchResponse | undefined;
    let getText = '';
    try {
      res = await containerFetch(baseUrl, {
        url: site.url.replace(/^http:/, 'https:'),
        timeoutSeconds: 45,
        rawOnly: false,
      });
      getText = summaryLine(res);
    } catch (err) {
      getText = `THREW: ${err instanceof Error ? err.message : String(err)}`;
    }
    process.stderr.write(getText + '\n');

    // Save rendered HTML as an eval fixture.
    if (res?.outcome === 'fetched' && res.content.ext === 'html') {
      const raw = Buffer.from(res.content.raw, 'base64').toString('utf8');
      const fdir = join(fixturesDir, site.id);
      mkdirSync(fdir, { recursive: true });
      writeFileSync(join(fdir, 'input.html'), raw);
      writeFileSync(join(fdir, 'fixture.json'), JSON.stringify({
        url: site.url, category: site.category, notes: site.note,
        capturedAt: '2026-06-10', real: true,
      }, null, 2) + '\n');
      process.stderr.write(`  saved fixture (${raw.length}b)\n`);
    } else {
      process.stderr.write('  no rendered html: fixture skipped\n');
    }

    if (!E2E_REVIEW.has(site.id) || res?.outcome !== 'fetched') continue;

    const markdown = res.content.markdown ?? '';
    const sections = formatOutline(res.sections);
    const summary = extractiveEngine.summarise(markdown, 5);
    const keywords = extractiveEngine.keywords(markdown, 12).join(', ');

    review.push(`## ${site.id}`, '', `${site.note}`, '',
      '### fetch', '```', getText.slice(0, 1400), '```', '',
      '### outline', '```',
      sections.split('\n').slice(0, 40).join('\n'), '```', '',
      '### summary', '```', summary.slice(0, 1200), '```', '',
      '### keywords', '```', keywords.slice(0, 400), '```', '');
  }

  writeFileSync(reviewPath, review.join('\n') + '\n');
  process.stderr.write(`\nWrote ${reviewPath}\n`);
  await realRunner.exec('docker', ['rm', '-f', CONTAINER], 30_000);
}

main().catch((err) => { console.error(err); process.exit(1); });
