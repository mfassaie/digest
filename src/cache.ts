import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { CacheMeta, Section } from './types.js';

export function getCacheRoot(override?: string): string {
  return override ?? join(
    homedir(), '.claude', 'digest', 'cache',
  );
}

// Relative cache path "<domain>/<sha256(url)>" sent to the container, which
// writes files under <dataRoot>/<cachePath>/.
export function getCachePath(url: string): string {
  const parsed = new URL(url);
  const hash = createHash('sha256').update(url).digest('hex');
  return `${parsed.host}/${hash}`;
}

export function getCacheDir(url: string, cacheRoot?: string): string {
  return join(getCacheRoot(cacheRoot), getCachePath(url));
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
