import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSlug from 'rehype-slug';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Converter } from '../converter.js';
import { extractMainContent } from '../extract.js';

const pipeline = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSlug)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    listItemIndent: 'one',
  });

async function toMarkdown(html: string): Promise<string> {
  const file = await pipeline.process(html);
  return String(file);
}

// unified/rehype AST pipeline paired with Readability extraction.
export const rehypeReadability: Converter = {
  name: 'readability+rehype',
  extracts: true,
  note: 'Readability -> rehype-parse/slug/remark/gfm/stringify',
  async convert(html, url) {
    const { html: content, title } = extractMainContent(html, url);
    return { markdown: await toMarkdown(content), title };
  },
};

// rehype on the full document, no extraction (baseline for the AST path).
export const rehypeRaw: Converter = {
  name: 'rehype-raw',
  extracts: false,
  note: 'rehype pipeline on full document (no extraction)',
  async convert(html) {
    return { markdown: await toMarkdown(html) };
  },
};
