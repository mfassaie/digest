import { mkdir } from 'node:fs/promises';
import { platform } from 'node:os';
import type { ConfigTarget } from './types.js';
import { readJsonFile, writeJsonFile } from
  './cli-json.js';

export function buildMcpEntry(): Record<string, unknown> {
  const isWin = platform() === 'win32';
  return {
    command: isWin ? 'cmd' : 'npx',
    args: isWin
      ? ['/c', 'npx', '-y', 'webfetch-plus']
      : ['-y', 'webfetch-plus'],
    env: { NODE_OPTIONS: '--use-system-ca' },
  };
}

const DENY_REASON =
  'Use mcp__webfetch-plus__webfetch_plus instead.' +
  ' Built-in WebFetch is disabled.';

export function buildHookCommand(): string {
  const payload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: DENY_REASON,
    },
  });
  return `node -e "process.stdout.write(${
    JSON.stringify(payload)
  })"`;
}

export function addMcpServer(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const servers = (config.mcpServers ?? {}) as
    Record<string, unknown>;
  servers['webfetch-plus'] = buildMcpEntry();
  return { ...config, mcpServers: servers };
}

export function addPreToolUseHook(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const hooks = (config.hooks ?? {}) as
    Record<string, unknown>;
  const preToolUse = (
    (hooks.PreToolUse ?? []) as unknown[]
  ).filter(
    (h: unknown) =>
      (h as { matcher?: string }).matcher !== 'WebFetch',
  );
  preToolUse.push({
    matcher: 'WebFetch',
    hooks: [{
      type: 'command',
      command: buildHookCommand(),
    }],
  });
  return {
    ...config,
    hooks: { ...hooks, PreToolUse: preToolUse },
  };
}

export function addPermissions(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const perms = (config.permissions ?? {}) as
    Record<string, unknown>;
  const deny = (
    (perms.deny ?? []) as string[]
  ).filter(r => r !== 'WebFetch');
  deny.push('WebFetch');
  const allow = (
    (perms.allow ?? []) as string[]
  ).filter(
    r => r !== 'mcp__webfetch-plus__webfetch_plus',
  );
  allow.push('mcp__webfetch-plus__webfetch_plus');
  return {
    ...config,
    permissions: { ...perms, deny, allow },
  };
}

export async function install(
  target: ConfigTarget,
): Promise<string[]> {
  const log: string[] = [];

  await mkdir(target.settingsDir, { recursive: true });

  const mcp = await readJsonFile(target.mcpConfig);
  await writeJsonFile(
    target.mcpConfig, addMcpServer(mcp),
  );
  log.push(`  ${target.mcpConfig}: MCP server registered`);

  const settings = await readJsonFile(target.settings);
  await writeJsonFile(
    target.settings, addPreToolUseHook(settings),
  );
  log.push(`  ${target.settings}: WebFetch hook added`);

  const local = await readJsonFile(target.localSettings);
  await writeJsonFile(
    target.localSettings, addPermissions(local),
  );
  log.push(
    `  ${target.localSettings}: deny/allow rules set`,
  );

  return log;
}
