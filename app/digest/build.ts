import { build } from 'esbuild';
import { chmodSync, cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildArtefactIndexJsonSchema, buildDigestJsonSchema,
} from '@digest/shared';
import { settingsJsonSchema } from '@digest/shared/settings';

const here = dirname(fileURLToPath(import.meta.url));

// Bundle the bin: workspace packages (@digest/*) are compiled in from
// source; npm deps stay external and are declared in dependencies so the
// published package resolves them at install time.
await build({
  entryPoints: [join(here, 'src', 'index.ts')],
  outfile: join(here, 'dist', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: [
    '@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod',
    'yaml',
  ],
  legalComments: 'none',
  logLevel: 'info',
});
chmodSync(join(here, 'dist', 'index.js'), 0o755);

// Settings JSON schema for editor validation of settings files
// (digest.settings.json / ~/.config/digest/settings.json). Generated from
// the same zod source the loader validates with, so file schema and
// runtime validation cannot drift (per-type pipelines design §4.2).
writeFileSync(
  join(here, 'dist', 'digest-settings.schema.json'),
  JSON.stringify(settingsJsonSchema(), null, 2) + '\n',
);

// Artefact store record schemas (plan M2, ADR-011 §2.1/§2.2): generated
// from the zod source in @digest/shared so digest.json /
// artefact-index.json validation cannot drift from what the store writes.
writeFileSync(
  join(here, 'dist', 'digest.schema.json'),
  JSON.stringify(buildDigestJsonSchema(), null, 2) + '\n',
);
writeFileSync(
  join(here, 'dist', 'artefact-index.schema.json'),
  JSON.stringify(buildArtefactIndexJsonSchema(), null, 2) + '\n',
);

// Copy @digest/docker's generated image build context into the published
// payload. app/digest/docker is generated output (gitignored); `digest
// setup` builds the image from it after npm install.
const contextSrc = join(
  here, '..', '..', 'packages', 'docker', 'dist', 'docker',
);
if (!existsSync(join(contextSrc, 'service.mjs'))) {
  throw new Error(
    `Missing image context at ${contextSrc} — build @digest/docker first ` +
    '(pnpm -r build, or pnpm --filter @digest/docker build).',
  );
}
const contextDest = join(here, 'docker');
rmSync(contextDest, { recursive: true, force: true });
cpSync(contextSrc, contextDest, { recursive: true });

process.stderr.write('Built dist/index.js and copied the docker/ context\n');
