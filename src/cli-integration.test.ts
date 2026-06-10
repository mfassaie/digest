import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from
  'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  install, buildHookCommand, buildMcpEntry,
} from './cli-install.js';
import { uninstall } from './cli-uninstall.js';
import {
  readJsonFile,
  writeJsonFile,
} from './cli-json.js';
import {
  resolveProjectTarget,
  isProjectRoot,
} from './cli-config.js';
import type { ConfigTarget } from './types.js';

const dirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wfp-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

describe('install end-to-end', () => {
  it('fresh install creates all config files', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      join(dir, 'package.json'), '{}', 'utf8',
    );

    const target = resolveProjectTarget(dir);
    const log = await install(target);

    expect(log).toHaveLength(3);

    // .mcp.json
    const mcp = JSON.parse(
      await readFile(target.mcpConfig, 'utf8'),
    );
    expect(mcp.mcpServers['falk-document']).toEqual(
      buildMcpEntry(),
    );

    // .claude/settings.json
    const settings = JSON.parse(
      await readFile(target.settings, 'utf8'),
    );
    const preToolUse = settings.hooks.PreToolUse;
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0].matcher).toBe('WebFetch');
    expect(preToolUse[0].hooks[0].type).toBe('command');
    expect(preToolUse[0].hooks[0].command).toBe(
      buildHookCommand(),
    );

    // .claude/settings.local.json
    const local = JSON.parse(
      await readFile(target.localSettings, 'utf8'),
    );
    expect(local.permissions.deny).toEqual(['WebFetch']);
    expect(local.permissions.allow).toEqual([
      'mcp__falk-document__falk_document_get',
      'mcp__falk-document__falk_document_read',
    ]);
  });

  it('preserves existing servers in .mcp.json', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      join(dir, 'package.json'), '{}', 'utf8',
    );

    const target = resolveProjectTarget(dir);

    // Pre-populate .mcp.json with another server
    const existing = {
      mcpServers: {
        'other-server': {
          command: 'node',
          args: ['other.js'],
        },
      },
    };
    await writeFile(
      target.mcpConfig,
      JSON.stringify(existing, null, 2) + '\n',
      'utf8',
    );

    await install(target);

    const mcp = JSON.parse(
      await readFile(target.mcpConfig, 'utf8'),
    );
    expect(mcp.mcpServers['other-server']).toEqual({
      command: 'node',
      args: ['other.js'],
    });
    expect(mcp.mcpServers['falk-document']).toEqual(
      buildMcpEntry(),
    );
  });
});

describe('isProjectRoot', () => {
  it('returns false for empty directory', async () => {
    const dir = await makeTmpDir();
    expect(await isProjectRoot(dir)).toBe(false);
  });

  it('returns true when package.json exists', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      join(dir, 'package.json'), '{}', 'utf8',
    );
    expect(await isProjectRoot(dir)).toBe(true);
  });

  it('returns true when .git exists', async () => {
    const dir = await makeTmpDir();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.git'));
    expect(await isProjectRoot(dir)).toBe(true);
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveGlobalTarget(
  home: string,
): ConfigTarget {
  const claudeDir = join(home, '.claude');
  return {
    mcpConfig: join(home, '.claude.json'),
    settings: join(claudeDir, 'settings.json'),
    localSettings: join(
      claudeDir, 'settings.local.json',
    ),
    settingsDir: claudeDir,
  };
}

describe('uninstall integration (project scope)', () => {
  it('install then uninstall removes all files and .claude/ dir', async () => {
    const dir = await makeTmpDir();
    const target = resolveProjectTarget(dir);

    await install(target);
    expect(await exists(target.mcpConfig)).toBe(true);
    expect(await exists(target.settings)).toBe(true);
    expect(await exists(target.localSettings))
      .toBe(true);

    await uninstall(target);

    expect(await exists(target.mcpConfig)).toBe(false);
    expect(await exists(target.settings)).toBe(false);
    expect(await exists(target.localSettings))
      .toBe(false);
    expect(await exists(target.settingsDir))
      .toBe(false);
  });

  it('preserves other servers and hooks after uninstall', async () => {
    const dir = await makeTmpDir();
    const target = resolveProjectTarget(dir);

    await install(target);

    // Add another MCP server
    const mcp = await readJsonFile(target.mcpConfig);
    const servers = mcp.mcpServers as
      Record<string, unknown>;
    servers['other-server'] = {
      command: 'python',
      args: ['server.py'],
    };
    await writeJsonFile(target.mcpConfig, mcp);

    // Add another hook to settings
    const settings = await readJsonFile(target.settings);
    const hooks = settings.hooks as
      Record<string, unknown>;
    const preToolUse = hooks.PreToolUse as unknown[];
    preToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo hi' }],
    });
    await writeJsonFile(target.settings, settings);

    // Add another deny rule to local settings
    const local = await readJsonFile(
      target.localSettings,
    );
    const perms = local.permissions as
      Record<string, unknown>;
    (perms.deny as string[]).push('Bash');
    await writeJsonFile(target.localSettings, local);

    await uninstall(target);

    // .mcp.json should still exist with other server
    expect(await exists(target.mcpConfig)).toBe(true);
    const mcpAfter = await readJsonFile(
      target.mcpConfig,
    );
    expect(mcpAfter.mcpServers).toEqual({
      'other-server': {
        command: 'python',
        args: ['server.py'],
      },
    });
    expect(
      (mcpAfter.mcpServers as Record<string, unknown>)[
        'falk-document'
      ],
    ).toBeUndefined();

    // settings.json should still have the Bash hook
    expect(await exists(target.settings)).toBe(true);
    const settingsAfter = await readJsonFile(
      target.settings,
    );
    const hooksAfter = settingsAfter.hooks as
      Record<string, unknown>;
    const preToolUseAfter =
      hooksAfter.PreToolUse as unknown[];
    expect(preToolUseAfter).toHaveLength(1);
    expect(
      (preToolUseAfter[0] as { matcher: string }).matcher,
    ).toBe('Bash');

    // settings.local.json should still have Bash deny
    expect(await exists(target.localSettings))
      .toBe(true);
    const localAfter = await readJsonFile(
      target.localSettings,
    );
    const permsAfter = localAfter.permissions as
      Record<string, unknown>;
    expect(permsAfter.deny).toEqual(['Bash']);
  });

  it('uninstall when nothing is installed does not error', async () => {
    const dir = await makeTmpDir();
    const target = resolveProjectTarget(dir);

    const log = await uninstall(target);

    expect(log).toBeDefined();
    expect(log.length).toBeGreaterThan(0);
    // No files should remain after uninstall
    expect(await exists(target.mcpConfig)).toBe(false);
    expect(await exists(target.settings)).toBe(false);
    expect(await exists(target.localSettings))
      .toBe(false);
  });
});

describe('uninstall integration (global scope)', () => {
  it('install then uninstall removes all files and .claude/ dir', async () => {
    const fakeHome = await makeTmpDir();
    const target = resolveGlobalTarget(fakeHome);

    await install(target);
    expect(await exists(target.mcpConfig)).toBe(true);
    expect(await exists(target.settings)).toBe(true);
    expect(await exists(target.localSettings))
      .toBe(true);

    await uninstall(target);

    expect(await exists(target.mcpConfig)).toBe(false);
    expect(await exists(target.settings)).toBe(false);
    expect(await exists(target.localSettings))
      .toBe(false);
    expect(await exists(target.settingsDir))
      .toBe(false);
  });

  it('preserves other entries in global config', async () => {
    const fakeHome = await makeTmpDir();
    const target = resolveGlobalTarget(fakeHome);

    await install(target);

    // Add another MCP server
    const mcp = await readJsonFile(target.mcpConfig);
    const servers = mcp.mcpServers as
      Record<string, unknown>;
    servers['another-tool'] = {
      command: 'node',
      args: ['tool.js'],
    };
    await writeJsonFile(target.mcpConfig, mcp);

    await uninstall(target);

    expect(await exists(target.mcpConfig)).toBe(true);
    const mcpAfter = await readJsonFile(
      target.mcpConfig,
    );
    expect(mcpAfter.mcpServers).toEqual({
      'another-tool': {
        command: 'node',
        args: ['tool.js'],
      },
    });
  });

  it('uninstall when nothing is installed does not error', async () => {
    const fakeHome = await makeTmpDir();
    const target = resolveGlobalTarget(fakeHome);

    const log = await uninstall(target);

    expect(log).toBeDefined();
    expect(log.length).toBeGreaterThan(0);
    // No files should remain after uninstall
    expect(await exists(target.mcpConfig)).toBe(false);
    expect(await exists(target.settings)).toBe(false);
    expect(await exists(target.localSettings))
      .toBe(false);
  });

  it('global config paths use correct layout', async () => {
    const fakeHome = await makeTmpDir();
    const target = resolveGlobalTarget(fakeHome);

    // Global MCP config is .claude.json at home root
    expect(target.mcpConfig).toBe(
      join(fakeHome, '.claude.json'),
    );
    // Settings are in .claude/ under home
    expect(target.settings).toBe(
      join(fakeHome, '.claude', 'settings.json'),
    );
    expect(target.localSettings).toBe(
      join(
        fakeHome, '.claude', 'settings.local.json',
      ),
    );
  });
});

describe('NFR-006: install performance', () => {
  it('install completes in under 500ms', async () => {
    const dir = await makeTmpDir();
    const target = resolveProjectTarget(dir);
    const start = performance.now();
    await install(target);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
