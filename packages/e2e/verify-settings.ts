// Verification: settings loading precedence and rule resolution, plus doctor
// output reporting the settings source. No Docker needed.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  loadSettings, parseSettingsFile, type LoadedSettings,
} from '@digest/shared/settings';
import { resolveRule, resolveRuleForUri } from '@digest/shared/settings';

const tmp = mkdtempSync(join(tmpdir(), 'digest-settings-'));
const cleanups: string[] = [tmp];

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) process.exitCode = 1;
}

// 1. Defaults when no file exists
console.log('--- 1. Default settings (no file) ---');
const defaults = loadSettings({
  env: {},
  cwd: tmp,
  homeDir: tmp,
});
assert(defaults.source.kind === 'defaults', 'source is defaults');
assert(defaults.settings.types['text/html']?.retrieval === 'browser',
  'html default retrieval is browser');
assert(defaults.settings.types['*/*']?.retrieval === 'http',
  'catch-all default retrieval is http');

// 2. DIGEST_CONFIG override
console.log('\n--- 2. DIGEST_CONFIG explicit path ---');
const customFile = join(tmp, 'custom-settings.json');
writeFileSync(customFile, JSON.stringify({
  types: {
    'text/html': { runtime: 'local', retrieval: 'http', parser: 'defuddle' },
  },
  fetch: { timeout_seconds: 60, retries: 2 },
}));
const fromConfig = loadSettings({
  env: { DIGEST_CONFIG: customFile },
  cwd: tmp,
  homeDir: tmp,
});
assert(fromConfig.source.kind === 'file', 'source is file');
assert(
  fromConfig.source.kind === 'file' && fromConfig.source.origin === 'digest_config',
  'origin is digest_config',
);
assert(fromConfig.settings.types['text/html']?.runtime === 'local',
  'html rule overridden to local');
assert(fromConfig.settings.types['text/html']?.parser === 'defuddle',
  'html parser is defuddle (from override)');
assert(fromConfig.settings.fetch.timeout_seconds === 60,
  'fetch timeout overridden to 60');
assert(fromConfig.settings.fetch.retries === 2,
  'fetch retries overridden to 2');
// The */* rule should survive from defaults.
assert(fromConfig.settings.types['*/*']?.retrieval === 'http',
  'catch-all rule still present from defaults');

// 3. XDG config path
console.log('\n--- 3. XDG config home ---');
const xdgBase = join(tmp, 'xdg-config');
const xdgDir = join(xdgBase, 'digest');
mkdirSync(xdgDir, { recursive: true });
const xdgFile = join(xdgDir, 'settings.json');
writeFileSync(xdgFile, JSON.stringify({
  types: {
    'application/pdf': {
      retrieval: 'http', parser: 'raw',
      runtime: 'local', escalate: 'none',
    },
  },
}));
const fromXdg = loadSettings({
  env: { XDG_CONFIG_HOME: xdgBase },
  cwd: tmp,
  homeDir: tmp,
});
assert(fromXdg.source.kind === 'file', 'xdg source is file');
assert(
  fromXdg.source.kind === 'file' && fromXdg.source.origin === 'xdg',
  'origin is xdg',
);
assert(fromXdg.settings.types['application/pdf']?.runtime === 'local',
  'pdf rule merged from xdg file');

// 4. cwd file honoured in dev/test mode
console.log('\n--- 4. cwd file in dev mode ---');
const cwdDir = join(tmp, 'cwd-test');
mkdirSync(cwdDir, { recursive: true });
writeFileSync(join(cwdDir, 'digest.settings.json'), JSON.stringify({
  fetch: { timeout_seconds: 15, retries: 1 },
}));
const fromCwd = loadSettings({
  env: { DIGEST_REPO_ROOT: '/some/repo', VITEST: undefined },
  cwd: cwdDir,
  homeDir: tmp,
});
assert(fromCwd.source.kind === 'file', 'cwd source is file');
assert(
  fromCwd.source.kind === 'file' && fromCwd.source.origin === 'cwd',
  'origin is cwd',
);
assert(fromCwd.settings.fetch.timeout_seconds === 15,
  'fetch timeout from cwd file');

// 5. Rule resolution
console.log('\n--- 5. Rule resolution ---');
const settings = defaults.settings;
const htmlRule = resolveRule(settings, 'text/html');
assert(htmlRule.retrieval === 'browser', 'text/html resolves to browser');
const jsonRule = resolveRule(settings, 'application/json');
assert(jsonRule.retrieval === 'http', 'application/json falls to */*');
const mdRule = resolveRuleForUri(settings, 'https://example.com/doc.md');
assert(mdRule.retrieval === 'http',
  'provisional .md resolves via */* to http');
const htmlUri = resolveRuleForUri(settings, 'https://example.com/page.html');
assert(htmlUri.retrieval === 'browser',
  'provisional .html resolves to browser');

// 6. Invalid settings file
console.log('\n--- 6. Invalid settings file ---');
let caughtInvalid = false;
try {
  parseSettingsFile('{ "types": { "bad": {} } }', '/fake/path');
} catch (err) {
  caughtInvalid = (err as Error).message.includes('invalid');
}
assert(caughtInvalid, 'invalid settings file throws SettingsError');

let caughtBadJson = false;
try {
  parseSettingsFile('not json at all', '/fake/path');
} catch (err) {
  caughtBadJson = (err as Error).message.includes('invalid JSON');
}
assert(caughtBadJson, 'malformed JSON throws SettingsError');

// 7. Doctor reports settings source (subprocess check)
console.log('\n--- 7. Doctor output ---');
const pkgDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'digest',
);
const bin = join(pkgDir, 'dist', 'index.js');
try {
  const out = execFileSync(process.execPath, [bin, 'doctor'], {
    env: {
      ...process.env,
      DIGEST_ARTEFACT_ROOT: tmp,
      DIGEST_CONFIG: customFile,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert(out.includes('Settings'), 'doctor reports Settings check');
  assert(out.includes('DIGEST_CONFIG') || out.includes(customFile),
    'doctor reports the settings source');
  assert(out.includes('Effective type rules'),
    'doctor prints effective rules table');
  console.log('doctor output (first 600 chars):\n' +
    out.trim().slice(0, 600));
} catch (err) {
  // Doctor may fail (Docker missing, etc.) but should still produce output.
  const output = (err as { stdout?: string }).stdout ?? '';
  assert(output.includes('Settings'),
    'doctor reports Settings even when checks fail');
  console.log('doctor output (partial, first 600 chars):\n' +
    output.trim().slice(0, 600));
}

// Cleanup
for (const dir of cleanups) {
  rmSync(dir, { recursive: true, force: true });
}

const passed = process.exitCode !== 1;
console.log(passed ? '\nOK: settings verification passed' : '\nFAILED');
process.exit(passed ? 0 : 1);
