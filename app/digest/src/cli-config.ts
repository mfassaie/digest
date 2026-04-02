import { join } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import type { ConfigTarget } from './types.js';

export function resolveProjectTarget(
  cwd: string,
): ConfigTarget {
  const claudeDir = join(cwd, '.claude');
  return {
    mcpConfig: join(cwd, '.mcp.json'),
    settings: join(claudeDir, 'settings.json'),
    localSettings: join(claudeDir, 'settings.local.json'),
    settingsDir: claudeDir,
  };
}

export function resolveGlobalTarget(): ConfigTarget {
  const home = homedir();
  const claudeDir = join(home, '.claude');
  return {
    mcpConfig: join(home, '.claude.json'),
    settings: join(claudeDir, 'settings.json'),
    localSettings: join(claudeDir, 'settings.local.json'),
    settingsDir: claudeDir,
  };
}

export async function isProjectRoot(
  dir: string,
): Promise<boolean> {
  const checks = [
    join(dir, 'package.json'),
    join(dir, '.git'),
  ];
  for (const p of checks) {
    try {
      await access(p);
      return true;
    } catch {
      // not found, try next
    }
  }
  return false;
}
