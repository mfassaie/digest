// Phase 3 verification: with DIGEST_REPO_ROOT set, the bin re-execs from the
// repo source under a watcher and the server comes up. Spawns the built bin,
// keeps stdin open, captures stderr, checks for the dev marker + ready line.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The digest host package (its src/ + dist/) lives under packages/digest.
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'digest');
const bin = join(pkg, 'dist', 'index.js');

const child = spawn(process.execPath, [bin], {
  env: { ...process.env, DIGEST_REPO_ROOT: pkg, DIGEST_DEV_CHILD: '' },
  stdio: ['pipe', 'ignore', 'pipe'],
});

let err = '';
child.stderr.on('data', (d) => { err += String(d); });

setTimeout(() => {
  child.kill('SIGKILL');
  const devMarker = err.includes('dev mode, running from');
  const ready = /digest .* ready/.test(err);
  const failed = err.includes('dev mode failed');
  console.log('dev marker:', devMarker);
  console.log('server ready (child started from source):', ready);
  console.log('dev start failed:', failed);
  console.log('--- stderr ---\n' + err.trim().slice(0, 600));
  process.exit(devMarker && ready && !failed ? 0 : 1);
}, 8000);
