import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { CacheMeta } from './types.js';

export function getCacheRoot(override?: string): string {
  return override ?? join(
    homedir(), '.claude', 'webfetch-plus', 'cache'
  );
}

export function getCacheDir(
  url: string, cacheRoot?: string,
): string {
  const root = getCacheRoot(cacheRoot);
  const parsed = new URL(url);
  const domain = parsed.host;
  const hash = createHash('sha256').update(url).digest('hex');
  return join(root, domain, hash);
}

export async function writeCacheEntry(
  dir: string,
  meta: CacheMeta,
  rawBody: Buffer,
  rawExt: string,
  markdown?: string,
): Promise<{ rawFile: string; markdownFile?: string }> {
  await mkdir(dir, { recursive: true });

  const rawFile = join(dir, `raw.${rawExt}`);
  await writeFile(rawFile, rawBody);

  let markdownFile: string | undefined;
  if (markdown !== undefined) {
    markdownFile = join(dir, 'content.md');
    await writeFile(markdownFile, markdown, 'utf8');
  }

  await writeFile(
    join(dir, 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf8',
  );

  return { rawFile, markdownFile };
}

export async function readCacheMeta(
  dir: string,
): Promise<CacheMeta | null> {
  try {
    const data = await readFile(join(dir, 'meta.json'), 'utf8');
    return JSON.parse(data) as CacheMeta;
  } catch {
    return null;
  }
}

export async function hasCacheEntry(
  url: string, cacheRoot?: string,
): Promise<boolean> {
  const dir = getCacheDir(url, cacheRoot);
  try {
    await access(join(dir, 'meta.json'));
    return true;
  } catch {
    return false;
  }
}
