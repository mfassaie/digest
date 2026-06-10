import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { Converter } from '../converter.js';
import { extractMainContent } from '../extract.js';

function makeService(): TurndownService {
  const svc = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  svc.use(gfm);
  return svc;
}

// Pure converter paired with Readability extraction.
export const turndownReadability: Converter = {
  name: 'readability+turndown',
  extracts: true,
  note: 'Readability extract -> turndown + gfm plugin',
  async convert(html, url) {
    const { html: content, title } = extractMainContent(html, url);
    return { markdown: makeService().turndown(content), title };
  },
};

// Baseline: turndown on the full document, no extraction.
export const turndownRaw: Converter = {
  name: 'turndown-raw',
  extracts: false,
  note: 'turndown + gfm on full document (no extraction, baseline)',
  async convert(html) {
    return { markdown: makeService().turndown(html) };
  },
};
