import { access, constants } from 'node:fs/promises';
import {
  realRunner, detectDocker, imagePresent, DockerUnavailableError,
  type CommandRunner,
} from '@digest/docker';
import {
  getArtefactRoot, getCacheRoot, getLogsDir, getRepoRoot,
} from '@digest/shared';
import {
  loadSettings, SettingsError,
  type LoadedSettings, type Settings, type SettingsSource,
} from '@digest/shared/settings';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

// Diagnose the digest environment: Docker, the local image, the settings
// (source, validity, effective rules) and the artefact root. The runner is
// injectable for tests.
export async function doctor(
  runner: CommandRunner = realRunner,
): Promise<number> {
  const checks: Check[] = [];

  try {
    await detectDocker(runner);
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
    img = await imagePresent(runner);
  } catch {
    img = false;
  }
  checks.push({
    name: 'Image', ok: img,
    detail: img ? 'digest:local present'
      : 'missing — run `digest setup`',
  });

  // Settings (plan M1): report the source and the validation state; an
  // invalid file is a hard startup error, so doctor fails the check.
  let loaded: LoadedSettings | undefined;
  try {
    loaded = loadSettings();
    checks.push({
      name: 'Settings', ok: true,
      detail: `${describeSource(loaded.source)}, valid`,
    });
  } catch (err) {
    checks.push({
      name: 'Settings', ok: false,
      detail: err instanceof SettingsError ? err.message : String(err),
    });
  }

  checks.push({
    name: 'Artefact root', ok: true, detail: getArtefactRoot(),
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
    const [first, ...rest] = c.detail.split('\n');
    console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}: ${first}`);
    for (const line of rest) console.log(`     ${line}`);
  }

  if (loaded) {
    console.log(
      '\nEffective type rules (retrieval, parser, runtime, escalation):',
    );
    for (const line of ruleTable(loaded.settings)) {
      console.log(`  ${line}`);
    }
  }

  const healthy = checks.every((c) => c.ok);
  console.log(healthy ? '\nAll checks passed.' : '\nSome checks failed.');
  return healthy ? 0 : 1;
}

function describeSource(source: SettingsSource): string {
  if (source.kind === 'defaults') {
    return 'built-in defaults (no settings file)';
  }
  const origin = {
    digest_config: 'DIGEST_CONFIG',
    cwd: 'cwd dev file',
    xdg: 'user config',
  }[source.origin];
  return `${source.path} (${origin})`;
}

// The merged per-MIME rule table actually in force (exact > type/* > */*),
// one aligned row per pattern.
function ruleTable(settings: Settings): string[] {
  const rows = Object.entries(settings.types).map(
    ([pattern, r]) => [pattern, r.retrieval, r.parser, r.runtime, r.escalate],
  );
  const widths = rows[0].map(
    (_, col) => Math.max(...rows.map((row) => row[col].length)),
  );
  return rows.map(
    (row) => row.map((cell, col) => cell.padEnd(widths[col]))
      .join('  ').trimEnd(),
  );
}
