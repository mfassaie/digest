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
  // A failed warning-severity check is reported but does not fail doctor.
  severity: 'error' | 'warning';
  detail: string;
}

// Diagnose the digest environment: Docker, the local image, the settings
// (source, validity, effective rules) and the artefact root. The runner is
// injectable for tests.
export async function doctor(
  runner: CommandRunner = realRunner,
): Promise<number> {
  const checks: Check[] = [];

  // Settings load first: the Docker requirement's severity depends on the
  // effective rules (plan M4, design §4.9) — a hard requirement when any
  // rule runs in the container, a warning when everything is local.
  let loaded: LoadedSettings | undefined;
  let settingsCheck: Check;
  try {
    loaded = loadSettings();
    settingsCheck = {
      name: 'Settings', ok: true, severity: 'error',
      detail: `${describeSource(loaded.source)}, valid`,
    };
  } catch (err) {
    settingsCheck = {
      name: 'Settings', ok: false, severity: 'error',
      detail: err instanceof SettingsError ? err.message : String(err),
    };
  }
  // Unknown settings are treated as needing the container (defaults do).
  const needsContainer = loaded === undefined
    || Object.values(loaded.settings.types)
      .some((rule) => rule.runtime === 'container');
  const dockerSeverity = needsContainer ? 'error' : 'warning';
  const optionalNote = needsContainer
    ? '' : ' (optional: no effective rule needs the container)';

  try {
    await detectDocker(runner);
    checks.push({
      name: 'Docker', ok: true, severity: dockerSeverity,
      detail: 'available',
    });
  } catch (err) {
    const reason = err instanceof DockerUnavailableError
      ? err.message.split('\n')[0] : String(err);
    checks.push({
      name: 'Docker', ok: false, severity: dockerSeverity,
      detail: reason + optionalNote,
    });
  }

  let img = false;
  try {
    img = await imagePresent(runner);
  } catch {
    img = false;
  }
  checks.push({
    name: 'Image', ok: img, severity: dockerSeverity,
    detail: img ? 'digest:local present'
      : 'missing — run `digest setup`' + optionalNote,
  });

  checks.push(settingsCheck);

  checks.push({
    name: 'Artefact root', ok: true, severity: 'error',
    detail: getArtefactRoot(),
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
    name: 'Cache', ok: true, severity: 'error',
    detail: cacheOk ? `${cacheRoot} writable`
      : `${cacheRoot} (created on first use)`,
  });

  checks.push({
    name: 'Logs', ok: true, severity: 'error', detail: getLogsDir(),
  });

  const repo = getRepoRoot();
  if (repo) {
    checks.push({
      name: 'Dev mode', ok: true, severity: 'error', detail: `repo ${repo}`,
    });
  }

  for (const c of checks) {
    const status = c.ok ? 'OK  ' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    const [first, ...rest] = c.detail.split('\n');
    console.log(`${status} ${c.name}: ${first}`);
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

  const failed = checks.some((c) => !c.ok && c.severity === 'error');
  const warned = checks.some((c) => !c.ok && c.severity === 'warning');
  console.log(failed
    ? '\nSome checks failed.'
    : warned ? '\nAll required checks passed (warnings above).'
      : '\nAll checks passed.');
  return failed ? 1 : 0;
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
