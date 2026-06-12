import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS, settingsFileSchema, typeRuleSchema,
  type Settings, type SettingsFile, type TypeRule, type TypeRuleOverride,
} from './schema.js';

// Settings loading (per-type pipelines design §4.2). Precedence, first
// hit wins:
//   1. DIGEST_CONFIG (explicit path — tests, CI, overrides)
//   2. <cwd>/digest.settings.json, dev mode or test env only
//   3. $XDG_CONFIG_HOME|~/.config/digest/settings.json
//   4. built-in defaults
// A missing file falls through to the next source; an unreadable or
// invalid file is a hard startup error (ADR-007: no silent fallback).

export class SettingsError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

export type SettingsOrigin = 'digest_config' | 'cwd' | 'xdg';

export type SettingsSource =
  | { kind: 'defaults' }
  | { kind: 'file'; origin: SettingsOrigin; path: string };

export interface LoadedSettings {
  settings: Settings;
  source: SettingsSource;
}

// Injectable for tests; defaults read the real process environment.
export interface LoadOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  homeDir?: string;
}

export function loadSettings(opts: LoadOptions = {}): LoadedSettings {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.homeDir ?? homedir();
  for (const candidate of candidatePaths(env, cwd, home)) {
    const text = readIfPresent(candidate.path);
    if (text === undefined) continue;
    const file = parseSettingsFile(text, candidate.path);
    return {
      settings: mergeSettings(file, candidate.path),
      source: { kind: 'file', origin: candidate.origin, path: candidate.path },
    };
  }
  return { settings: DEFAULT_SETTINGS, source: { kind: 'defaults' } };
}

function candidatePaths(
  env: Record<string, string | undefined>, cwd: string, home: string,
): { origin: SettingsOrigin; path: string }[] {
  const candidates: { origin: SettingsOrigin; path: string }[] = [];
  const explicit = env.DIGEST_CONFIG?.trim();
  if (explicit) candidates.push({ origin: 'digest_config', path: explicit });
  if (isDevOrTest(env)) {
    candidates.push({ origin: 'cwd', path: join(cwd, 'digest.settings.json') });
  }
  // XDG_CONFIG_HOME honoured when set, literal ~/.config otherwise,
  // including on Windows (design §6, confirmed 13-06-2026).
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg || join(home, '.config');
  candidates.push({ origin: 'xdg', path: join(base, 'digest', 'settings.json') });
  return candidates;
}

// The cwd file is honoured only in dev mode (DIGEST_REPO_ROOT) or under
// a test runner, so a stray digest.settings.json cannot change
// production behaviour (design §4.2).
function isDevOrTest(env: Record<string, string | undefined>): boolean {
  if (env.DIGEST_REPO_ROOT?.trim()) return true;
  return env.VITEST !== undefined || env.NODE_ENV === 'test';
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw new SettingsError(
      `cannot read settings file ${path}: ${(err as Error).message}`, path,
    );
  }
}

// JSON-parse and schema-validate one settings file. Exported for doctor,
// which reports on sources without loading them.
export function parseSettingsFile(text: string, path: string): SettingsFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new SettingsError(
      `invalid JSON in settings file ${path}: ${(err as Error).message}`,
      path,
    );
  }
  const result = settingsFileSchema.safeParse(data);
  if (!result.success) {
    throw new SettingsError(
      `invalid settings in ${path}:\n${z.prettifyError(result.error)}`, path,
    );
  }
  return result.data;
}

// Effective settings: built-in defaults overlaid with the file, each
// file rule completed from the built-in rule for its pattern, then the
// built-in */* (design §4.1). Effective rules are re-validated so an
// override composing into browser-without-container (e.g. runtime
// 'local' on text/html, whose built-in retrieval is 'browser') still
// fails at startup.
export function mergeSettings(file: SettingsFile, path?: string): Settings {
  const types: Record<string, TypeRule> = { ...DEFAULT_SETTINGS.types };
  for (const [pattern, override] of Object.entries(file.types ?? {})) {
    types[pattern] = completeRule(pattern, override, path);
  }
  return {
    types,
    chunking: {
      standard: {
        ...DEFAULT_SETTINGS.chunking.standard,
        ...(file.chunking?.standard ?? {}),
      },
    },
    fetch: { ...(file.fetch ?? DEFAULT_SETTINGS.fetch) },
  };
}

function completeRule(
  pattern: string, override: TypeRuleOverride, path?: string,
): TypeRule {
  const base = DEFAULT_SETTINGS.types[pattern] ?? DEFAULT_SETTINGS.types['*/*'];
  const checked = typeRuleSchema.safeParse({
    retrieval: override.retrieval ?? base.retrieval,
    parser: override.parser ?? base.parser,
    runtime: override.runtime ?? base.runtime,
    escalate: override.escalate ?? base.escalate,
  });
  if (!checked.success) {
    const at = path === undefined ? '' : ` in ${path}`;
    throw new SettingsError(
      `invalid effective rule for '${pattern}'${at}:\n` +
      z.prettifyError(checked.error),
      path,
    );
  }
  return checked.data;
}
