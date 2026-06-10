import type { Converter } from './converter.js';
import { defuddleConverter } from './adapters/defuddle.js';
import { turndownReadability, turndownRaw } from './adapters/turndown.js';
import { rehypeReadability, rehypeRaw } from './adapters/rehype.js';
import { mdreamConverter } from './adapters/mdream.js';
import {
  goHtml2mdRaw,
  goHtml2mdReadability,
  goBinaryAvailable,
} from './adapters/go-html2md.js';

// All candidate converters. Go variants are included only when the pinned
// binary is present (downloaded out-of-band, not committed).
export function allConverters(): Converter[] {
  const list: Converter[] = [
    defuddleConverter,
    turndownReadability,
    turndownRaw,
    rehypeReadability,
    rehypeRaw,
    mdreamConverter,
  ];
  if (goBinaryAvailable()) {
    list.push(goHtml2mdRaw, goHtml2mdReadability);
  }
  return list;
}

export function converterByName(name: string): Converter | undefined {
  return allConverters().find((c) => c.name === name);
}
