import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import type { Converter } from '../converter.js';

// Incumbent (v1). Extracts main content and converts in one step.
export const defuddleConverter: Converter = {
  name: 'defuddle',
  extracts: true,
  note: 'defuddle/node + linkedom (v1 incumbent)',
  async convert(html, url) {
    const { document } = parseHTML(html);
    const result = await Defuddle(document, url, { markdown: true });
    return { markdown: result.content, title: result.title };
  },
};
