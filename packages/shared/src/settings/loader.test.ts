import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SettingsError, loadSettings, mergeSettings, parseSettingsFile,
} from './loader.js';
import { DEFAULT_SETTINGS } from './schema.js';

let root: string;
let home: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'digest-settings-'));
  home = join(root, 'home');
  cwd = join(root, 'cwd');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const MD_LOCAL = {
  types: {
    'text/markdown': {
      retrieval: 'http', parser: 'passthrough', runtime: 'local',
    },
  },
};

describe('loadSettings precedence', () => {
  it('returns built-in defaults when no source exists', () => {
    const { settings, source } = loadSettings({ env: {}, cwd, homeDir: home });
    expect(source).toEqual({ kind: 'defaults' });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('honours XDG_CONFIG_HOME when set', () => {
    const xdg = join(root, 'xdg');
    const path = writeJson(join(xdg, 'digest', 'settings.json'), MD_LOCAL);
    const { settings, source } = loadSettings({
      env: { XDG_CONFIG_HOME: xdg }, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'file', origin: 'xdg', path });
    expect(settings.types['text/markdown']?.runtime).toBe('local');
  });

  it('falls back to ~/.config/digest/settings.json without XDG', () => {
    const path = writeJson(
      join(home, '.config', 'digest', 'settings.json'), MD_LOCAL,
    );
    const { source } = loadSettings({ env: {}, cwd, homeDir: home });
    expect(source).toEqual({ kind: 'file', origin: 'xdg', path });
  });

  it('prefers the cwd file over XDG in a test env', () => {
    const xdg = join(root, 'xdg');
    writeJson(join(xdg, 'digest', 'settings.json'), MD_LOCAL);
    const path = writeJson(join(cwd, 'digest.settings.json'), {
      fetch: { retries: 2 },
    });
    const { settings, source } = loadSettings({
      env: { XDG_CONFIG_HOME: xdg, VITEST: 'true' }, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'file', origin: 'cwd', path });
    expect(settings.fetch.retries).toBe(2);
  });

  it('reads the cwd file in dev mode (DIGEST_REPO_ROOT)', () => {
    const path = writeJson(join(cwd, 'digest.settings.json'), MD_LOCAL);
    const { source } = loadSettings({
      env: { DIGEST_REPO_ROOT: join(root, 'repo') }, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'file', origin: 'cwd', path });
  });

  it('reads the cwd file when NODE_ENV is test', () => {
    writeJson(join(cwd, 'digest.settings.json'), MD_LOCAL);
    const { source } = loadSettings({
      env: { NODE_ENV: 'test' }, cwd, homeDir: home,
    });
    expect(source.kind).toBe('file');
  });

  it('ignores the cwd file outside dev mode and test envs', () => {
    writeJson(join(cwd, 'digest.settings.json'), MD_LOCAL);
    const { settings, source } = loadSettings({
      env: {}, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'defaults' });
    expect(settings.types['text/markdown']).toBeUndefined();
  });

  it('lets DIGEST_CONFIG win over every other source', () => {
    const explicit = writeJson(join(root, 'explicit.json'), {
      fetch: { timeout_seconds: 60 },
    });
    writeJson(join(cwd, 'digest.settings.json'), { fetch: { retries: 2 } });
    writeJson(join(home, '.config', 'digest', 'settings.json'), MD_LOCAL);
    const { settings, source } = loadSettings({
      env: { DIGEST_CONFIG: explicit, VITEST: 'true' }, cwd, homeDir: home,
    });
    expect(source).toEqual({
      kind: 'file', origin: 'digest_config', path: explicit,
    });
    expect(settings.fetch).toEqual({ timeout_seconds: 60, retries: 0 });
  });

  it('falls through a missing DIGEST_CONFIG path', () => {
    const path = writeJson(
      join(home, '.config', 'digest', 'settings.json'), MD_LOCAL,
    );
    const { source } = loadSettings({
      env: { DIGEST_CONFIG: join(root, 'nope.json') }, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'file', origin: 'xdg', path });
  });

  it('ignores a blank DIGEST_CONFIG', () => {
    const { source } = loadSettings({
      env: { DIGEST_CONFIG: '   ' }, cwd, homeDir: home,
    });
    expect(source).toEqual({ kind: 'defaults' });
  });

  it('defaults to the process environment when no options are given', () => {
    const ENV = { ...process.env };
    try {
      const explicit = writeJson(join(root, 'proc-env.json'), {
        fetch: { timeout_seconds: 45 },
      });
      process.env.DIGEST_CONFIG = explicit;
      const { settings, source } = loadSettings();
      expect(source).toEqual({
        kind: 'file', origin: 'digest_config', path: explicit,
      });
      expect(settings.fetch.timeout_seconds).toBe(45);
    } finally {
      process.env = { ...ENV };
    }
  });
});

describe('loadSettings hard errors', () => {
  it('rejects invalid JSON as a startup error', () => {
    const path = join(root, 'broken.json');
    writeFileSync(path, '{ not json');
    expect(() => loadSettings({
      env: { DIGEST_CONFIG: path }, cwd, homeDir: home,
    })).toThrowError(SettingsError);
  });

  it('rejects a schema-invalid file as a startup error', () => {
    const path = writeJson(join(root, 'bad.json'), {
      types: { 'text/html': { parser: 'pandoc' } },
    });
    expect(() => loadSettings({
      env: { DIGEST_CONFIG: path }, cwd, homeDir: home,
    })).toThrowError(/invalid settings/);
  });

  it('rejects browser-without-container stated explicitly', () => {
    const path = writeJson(join(root, 'bad.json'), {
      types: { 'text/html': { retrieval: 'browser', runtime: 'local' } },
    });
    expect(() => loadSettings({
      env: { DIGEST_CONFIG: path }, cwd, homeDir: home,
    })).toThrowError(/requires runtime 'container'/);
  });

  it('rejects browser-without-container composed via fill-in', () => {
    // text/html's built-in retrieval is 'browser'; forcing runtime
    // 'local' composes an invalid effective rule.
    const path = writeJson(join(root, 'bad.json'), {
      types: { 'text/html': { runtime: 'local' } },
    });
    expect(() => loadSettings({
      env: { DIGEST_CONFIG: path }, cwd, homeDir: home,
    })).toThrowError(/invalid effective rule for 'text\/html'/);
  });

  it('treats an unreadable path (a directory) as a hard error', () => {
    expect(() => loadSettings({
      env: { DIGEST_CONFIG: root }, cwd, homeDir: home,
    })).toThrowError(/cannot read settings file/);
  });
});

describe('mergeSettings', () => {
  it('completes partial rules from the built-in for the pattern, then */*',
    () => {
      const merged = mergeSettings(parseSettingsFile(JSON.stringify({
        types: {
          'text/html': { parser: 'raw' },
          'application/pdf': { runtime: 'local' },
        },
      }), 'inline'));
      // text/html keeps its built-in browser/container pair.
      expect(merged.types['text/html']).toEqual({
        retrieval: 'browser', parser: 'raw',
        runtime: 'container', escalate: 'browser',
      });
      // pdf has no built-in rule: fills from */*.
      expect(merged.types['application/pdf']).toEqual({
        retrieval: 'http', parser: 'raw',
        runtime: 'local', escalate: 'browser',
      });
    });

  it('keeps built-in rules for patterns the file does not mention', () => {
    const merged = mergeSettings({ types: { '*/*': { runtime: 'local' } } });
    expect(merged.types['text/html']).toEqual(
      DEFAULT_SETTINGS.types['text/html'],
    );
    expect(merged.types['*/*']?.runtime).toBe('local');
  });

  it('merges chunking strategies over the defaults', () => {
    const merged = mergeSettings({
      chunking: {
        standard: {
          'application/pdf': { strategy: 'bytes', chunk_bytes: 2048 },
        },
      },
    });
    expect(merged.chunking.standard['text/markdown'])
      .toEqual({ strategy: 'sections' });
    expect(merged.chunking.standard['*/*'])
      .toEqual({ strategy: 'bytes', chunk_bytes: 1_048_576 });
    expect(merged.chunking.standard['application/pdf'])
      .toEqual({ strategy: 'bytes', chunk_bytes: 2048 });
  });

  it('rejects an invalid effective rule without a file path too', () => {
    expect(() => mergeSettings({
      types: { 'text/html': { runtime: 'local' } },
    })).toThrowError(/invalid effective rule for 'text\/html':/);
  });

  it('fills fetch defaults field by field', () => {
    const viaSchema = parseSettingsFile(
      JSON.stringify({ fetch: { retries: 1 } }), 'inline',
    );
    expect(mergeSettings(viaSchema).fetch)
      .toEqual({ timeout_seconds: 30, retries: 1 });
    expect(mergeSettings({}).fetch).toEqual(DEFAULT_SETTINGS.fetch);
  });
});
