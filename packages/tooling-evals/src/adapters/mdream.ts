import type { Converter } from '../converter.js';

// mdream: LLM-optimised converter with a content-isolation plugin.
// The exact export shape is verified against the installed package in
// run-all (the adapter is skipped gracefully if the API differs).
export const mdreamConverter: Converter = {
  name: 'mdream',
  extracts: true,
  note: 'mdream htmlToMarkdown + isolateMainPlugin',
  async convert(html) {
    const mod = await import('mdream');
    const plugins = await import('mdream/plugins');
    const htmlToMarkdown = (mod as Record<string, unknown>)
      .htmlToMarkdown as (h: string, o?: unknown) => string;
    const isolateMain = (plugins as Record<string, unknown>)
      .isolateMainPlugin as (() => unknown) | undefined;
    const opts = isolateMain ? { plugins: [isolateMain()] } : undefined;
    return { markdown: htmlToMarkdown(html, opts) };
  },
};
