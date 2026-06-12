import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getCacheRoot } from './config.js';
import type { CacheMeta, Section } from './types.js';

// Relative cache path "<domain>/<sha256(url)>".
export function getCachePath(url: string): string {
  const parsed = new URL(url);
  const hash = createHash('sha256').update(url).digest('hex');
  return `${parsed.host}/${hash}`;
}

export function getCacheDir(url: string, cacheRoot?: string): string {
  return join(cacheRoot ?? getCacheRoot(), getCachePath(url));
}

export interface ContentToWrite {
  ext: string;
  raw: string; // base64
  markdown?: string;
  sections: Section[];
}

// Write the content the container returned into this session's cache dir.
// Returns the file names and byte sizes for the response.
export async function writeContent(
  dir: string, content: ContentToWrite,
): Promise<{
  rawFile: string;
  markdownFile?: string;
  structureFile?: string;
  rawSize: number;
  markdownSize?: number;
}> {
  await mkdir(dir, { recursive: true });
  const rawBytes = Buffer.from(content.raw, 'base64');
  const rawFile = `raw.${content.ext}`;
  await writeFile(join(dir, rawFile), rawBytes);

  let markdownFile: string | undefined;
  let markdownSize: number | undefined;
  if (content.markdown !== undefined) {
    markdownFile = 'content.md';
    await writeFile(join(dir, markdownFile), content.markdown, 'utf8');
    markdownSize = Buffer.byteLength(content.markdown, 'utf8');
    await writeFile(
      join(dir, 'structure.json'),
      JSON.stringify(content.sections, null, 2), 'utf8',
    );
  }
  return {
    rawFile,
    markdownFile,
    structureFile: markdownFile ? 'structure.json' : undefined,
    rawSize: rawBytes.length,
    markdownSize,
  };
}

export async function writeCacheMeta(
  dir: string, meta: CacheMeta,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8',
  );
}

export async function readCacheMeta(dir: string): Promise<CacheMeta | null> {
  try {
    return JSON.parse(
      await readFile(join(dir, 'meta.json'), 'utf8'),
    ) as CacheMeta;
  } catch {
    return null;
  }
}

export async function readMarkdown(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, 'content.md'), 'utf8');
  } catch {
    return null;
  }
}

export async function readStructure(dir: string): Promise<Section[] | null> {
  try {
    return JSON.parse(
      await readFile(join(dir, 'structure.json'), 'utf8'),
    ) as Section[];
  } catch {
    return null;
  }
}

export async function hasCacheEntry(
  url: string, cacheRoot?: string,
): Promise<boolean> {
  try {
    await access(join(getCacheDir(url, cacheRoot), 'meta.json'));
    return true;
  } catch {
    return false;
  }
}
