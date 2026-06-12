import { build } from 'esbuild';
import { chmodSync, cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'zod'],
  legalComments: 'none',
  logLevel: 'info',
});
chmodSync(join(here, 'dist', 'index.js'), 0o755);

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
