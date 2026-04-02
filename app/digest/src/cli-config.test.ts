import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  resolveProjectTarget,
  resolveGlobalTarget,
  isProjectRoot,
} from './cli-config.js';

describe('resolveProjectTarget', () => {
  it('places .mcp.json at the project root', () => {
    const t = resolveProjectTarget('/projects/my-app');
    expect(t.mcpConfig).toBe(join('/projects/my-app', '.mcp.json'));
  });

  it('places settings under .claude/', () => {
    const t = resolveProjectTarget('/projects/my-app');
    expect(t.settings).toBe(
      join('/projects/my-app', '.claude', 'settings.json'),
    );
    expect(t.localSettings).toBe(
      join('/projects/my-app', '.claude', 'settings.local.json'),
    );
  });

  it('sets settingsDir to the .claude directory', () => {
    const t = resolveProjectTarget('/projects/my-app');
    expect(t.settingsDir).toBe(join('/projects/my-app', '.claude'));
  });

  it('handles a root-level cwd', () => {
    const root = process.platform === 'win32' ? 'C:\\' : '/';
    const t = resolveProjectTarget(root);
    expect(t.mcpConfig).toBe(join(root, '.mcp.json'));
    expect(t.settingsDir).toBe(join(root, '.claude'));
  });
});

describe('resolveGlobalTarget', () => {
  const home = homedir();

  it('places .claude.json at the home root', () => {
    const t = resolveGlobalTarget();
    expect(t.mcpConfig).toBe(join(home, '.claude.json'));
  });

  it('places settings under ~/.claude/', () => {
    const t = resolveGlobalTarget();
    expect(t.settings).toBe(join(home, '.claude', 'settings.json'));
    expect(t.localSettings).toBe(
      join(home, '.claude', 'settings.local.json'),
    );
  });

  it('sets settingsDir to ~/.claude', () => {
    const t = resolveGlobalTarget();
    expect(t.settingsDir).toBe(join(home, '.claude'));
  });

  it('global mcpConfig differs from project mcpConfig', () => {
    const global = resolveGlobalTarget();
    const project = resolveProjectTarget(home);
    // Global is ~/.claude.json, project is ~/.mcp.json.
    expect(global.mcpConfig).not.toBe(project.mcpConfig);
  });
});

describe('isProjectRoot', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'digest-cfg-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns true when package.json exists', async () => {
    await writeFile(join(tempDir, 'package.json'), '{}');
    expect(await isProjectRoot(tempDir)).toBe(true);
  });

  it('returns true when .git exists', async () => {
    await mkdir(join(tempDir, '.git'));
    expect(await isProjectRoot(tempDir)).toBe(true);
  });

  it('returns false for an empty directory', async () => {
    expect(await isProjectRoot(tempDir)).toBe(false);
  });
});
