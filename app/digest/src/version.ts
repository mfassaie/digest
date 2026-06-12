import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cached: string | undefined;

// Single source of truth for the version: read from package.json at runtime
// (works from dist/ when published and from src/ under tsx — package.json is
// one level up in both layouts).
export function getVersion(): string {
  if (cached) return cached;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    cached = pkg.version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
