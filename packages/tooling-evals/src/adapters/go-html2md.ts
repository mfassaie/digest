import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Converter } from '../converter.js';
import { extractMainContent } from '../extract.js';

const here = dirname(fileURLToPath(import.meta.url));
const binName = process.platform === 'win32'
  ? 'html2markdown.exe' : 'html2markdown';
// Pinned binary downloaded by scripts/fetch-go-binary (not committed).
const binPath = join(here, '..', '..', 'bin', binName);

export function goBinaryAvailable(): boolean {
  return existsSync(binPath);
}

function run(html: string): string {
  const res = spawnSync(binPath, [], {
    input: html,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`html2markdown exited ${res.status}: ${res.stderr}`);
  }
  return res.stdout;
}

// JohannesKaufmann html-to-markdown v2 (Go), bare — no extraction.
export const goHtml2mdRaw: Converter = {
  name: 'go-html2md-raw',
  extracts: false,
  note: 'JohannesKaufmann html-to-markdown v2 CLI (no extraction)',
  async convert(html) {
    return { markdown: run(html) };
  },
};

// Go converter paired with Readability extraction (deployable form).
export const goHtml2mdReadability: Converter = {
  name: 'readability+go-html2md',
  extracts: true,
  note: 'Readability -> JohannesKaufmann html-to-markdown v2 CLI',
  async convert(html, url) {
    const { html: content, title } = extractMainContent(html, url);
    return { markdown: run(content), title };
  },
};
