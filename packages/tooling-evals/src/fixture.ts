import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', 'fixtures');

export type FixtureCategory =
  | 'docs-code'
  | 'tables'
  | 'news-boilerplate'
  | 'deep-lists'
  | 'spa'
  | 'mathml'
  | 'footnotes'
  | 'cjk'
  | 'large'
  | 'malformed';

export interface FixtureMeta {
  url: string;
  capturedAt?: string;
  category: FixtureCategory;
  notes?: string;
}

export interface Fixture {
  id: string;
  dir: string;
  meta: FixtureMeta;
  html: string;
  golden?: string;
}

export function loadFixture(id: string): Fixture {
  const dir = join(FIXTURES_DIR, id);
  const meta = JSON.parse(
    readFileSync(join(dir, 'fixture.json'), 'utf8'),
  ) as FixtureMeta;
  const html = readFileSync(join(dir, 'input.html'), 'utf8');
  const goldenPath = join(dir, 'golden.md');
  const golden = existsSync(goldenPath)
    ? readFileSync(goldenPath, 'utf8') : undefined;
  return { id, dir, meta, html, golden };
}

export function allFixtureIds(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(FIXTURES_DIR, d.name, 'fixture.json')))
    .map((d) => d.name)
    .sort();
}
