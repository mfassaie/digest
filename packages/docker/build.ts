import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Assemble the complete image build context under dist/docker: the in-
// container service bundled to a single file plus the static context files.
// The app build copies this directory into its published payload
// (app/digest/docker) so `digest setup` can build the image from the
// installed package.
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist', 'docker');
mkdirSync(outDir, { recursive: true });

// ESM output: defuddle/node only exports an `import` condition, so the
// bundle must be ESM to resolve it (and the other runtime deps) at runtime.
// Runtime deps are kept external and npm-installed inside the image
// (native/dynamic modules that do not bundle cleanly).
await build({
  entryPoints: [join(here, 'src', 'service', 'service.ts')],
  outfile: join(outDir, 'service.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['defuddle', 'linkedom', 'playwright-core'],
  legalComments: 'none',
  logLevel: 'info',
});

for (const f of ['Dockerfile', 'launch.sh', 'runtime-package.json']) {
  cpSync(join(here, 'docker', f), join(outDir, f));
}

process.stderr.write(`Built image context at ${outDir}\n`);
