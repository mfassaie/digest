import { access, constants } from 'node:fs/promises';
import {
  realRunner, detectDocker, imagePresent, DockerUnavailableError,
} from './docker.js';
import { getCacheRoot } from './cache.js';
import { getDocumentRoot, getLogsDir, getRepoRoot } from './config.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

// Diagnose the digest environment: Docker, the local image, and a
// writable cache directory.
export async function doctor(): Promise<number> {
  const checks: Check[] = [];

  try {
    await detectDocker(realRunner);
    checks.push({ name: 'Docker', ok: true, detail: 'available' });
  } catch (err) {
    checks.push({
      name: 'Docker', ok: false,
      detail: err instanceof DockerUnavailableError
        ? err.message.split('\n')[0] : String(err),
    });
  }

  let img = false;
  try {
    img = await imagePresent(realRunner);
  } catch {
    img = false;
  }
  checks.push({
    name: 'Image', ok: img,
    detail: img ? 'digest:local present'
      : 'missing — run `digest setup`',
  });

  checks.push({
    name: 'Document root', ok: true, detail: getDocumentRoot(),
  });

  const cacheRoot = getCacheRoot();
  let cacheOk = false;
  try {
    await access(cacheRoot, constants.W_OK);
    cacheOk = true;
  } catch {
    cacheOk = false; // may simply not exist yet
  }
  checks.push({
    name: 'Cache', ok: true,
    detail: cacheOk ? `${cacheRoot} writable`
      : `${cacheRoot} (created on first use)`,
  });

  checks.push({ name: 'Logs', ok: true, detail: getLogsDir() });

  const repo = getRepoRoot();
  if (repo) {
    checks.push({ name: 'Dev mode', ok: true, detail: `repo ${repo}` });
  }

  for (const c of checks) {
    console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${c.detail}`);
  }
  const healthy = checks.every((c) => c.ok);
  console.log(healthy ? '\nAll checks passed.' : '\nSome checks failed.');
  return healthy ? 0 : 1;
}
