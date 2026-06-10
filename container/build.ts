import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Bundle the service to a single CommonJS file under docker/, which ships in
// the npm package and is built into the local image. Runtime deps are kept
// external and npm-installed inside the image (native/dynamic modules that
// do not bundle cleanly).
const here = dirname(fileURLToPath(import.meta.url));
// ESM output: defuddle/node only exports an `import` condition, so the
// bundle must be ESM to resolve it (and the other runtime deps) at runtime.
const outfile = join(here, '..', 'docker', 'service.mjs');

await build({
  entryPoints: [join(here, 'src', 'service.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['defuddle', 'linkedom', 'playwright-core'],
  legalComments: 'none',
  logLevel: 'info',
});

process.stderr.write(`Built ${outfile}\n`);
