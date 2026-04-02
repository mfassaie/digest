import { readFile, writeFile, unlink, rmdir } from
  'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJsonFile(
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeJsonFile(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(data, null, 2) + '\n',
    'utf8',
  );
}

export async function deleteIfEmpty(
  path: string,
): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    if (Object.keys(data).length === 0) {
      await unlink(path);
      return true;
    }
  } catch {
    // file doesn't exist or isn't valid JSON
  }
  return false;
}

export async function deleteDirIfEmpty(
  dir: string,
): Promise<void> {
  try {
    await rmdir(dir);
  } catch {
    // not empty or doesn't exist
  }
}
