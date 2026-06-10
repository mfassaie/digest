import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IMAGE } from './docker.js';

// Locate the packaged docker/ build context. Works from dist/ (published)
// and from src/ (dev via tsx).
function dockerContext(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'docker');
}

// Build the local image. The CloakBrowser binary licence permits internal/
// derived images but forbids redistribution, so this image is built on the
// user's machine and never pushed to any registry.
export async function setup(): Promise<number> {
  const context = dockerContext();
  console.log(`Building ${IMAGE} from ${context} ...`);
  console.log(
    'Note: this image embeds CloakBrowser and is for local use only — ' +
    'do not push it to any registry (binary licence forbids redistribution).',
  );
  return await new Promise((resolve) => {
    const child = spawn(
      'docker', ['build', '-t', IMAGE, context],
      { stdio: 'inherit' },
    );
    child.on('error', (err) => {
      console.error(
        `docker build could not start: ${err.message}\n` +
        'Is Docker installed and running?',
      );
      resolve(1);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`\nDone. ${IMAGE} built. Run \`falk-document doctor\` ` +
          'to verify, then restart Claude Code.');
      }
      resolve(code ?? 1);
    });
  });
}
