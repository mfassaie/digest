import { access } from 'node:fs/promises';
import type { ConfigTarget } from './types.js';
import {
  readJsonFile,
  writeJsonFile,
  deleteIfEmpty,
  deleteDirIfEmpty,
} from './cli-json.js';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function removeMcpServer(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...config };
  const servers = { ...(result.mcpServers as
    Record<string, unknown> ?? {}) };
  delete servers['webfetch-plus']; // pre-rename
  delete servers['falk-document'];
  if (Object.keys(servers).length === 0) {
    delete result.mcpServers;
  } else {
    result.mcpServers = servers;
  }
  return result;
}

export function removePreToolUseHook(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...config };
  const hooks = { ...(result.hooks as
    Record<string, unknown> ?? {}) };
  const preToolUse = (
    (hooks.PreToolUse ?? []) as unknown[]
  ).filter(
    (h: unknown) =>
      (h as { matcher?: string }).matcher !== 'WebFetch',
  );
  if (preToolUse.length === 0) {
    delete hooks.PreToolUse;
  } else {
    hooks.PreToolUse = preToolUse;
  }
  if (Object.keys(hooks).length === 0) {
    delete result.hooks;
  } else {
    result.hooks = hooks;
  }
  return result;
}

export function removePermissions(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...config };
  const perms = { ...(result.permissions as
    Record<string, unknown> ?? {}) };
  const deny = (
    (perms.deny ?? []) as string[]
  ).filter(r => r !== 'WebFetch');
  const allow = (
    (perms.allow ?? []) as string[]
  ).filter(
    r => r !== 'mcp__webfetch-plus__webfetch_plus' &&
      r !== 'mcp__falk-document__falk_document_get' &&
      r !== 'mcp__falk-document__falk_document_read',
  );
  if (deny.length === 0) delete perms.deny;
  else perms.deny = deny;
  if (allow.length === 0) delete perms.allow;
  else perms.allow = allow;
  if (Object.keys(perms).length === 0) {
    delete result.permissions;
  } else {
    result.permissions = perms;
  }
  return result;
}

export async function uninstall(
  target: ConfigTarget,
): Promise<string[]> {
  const log: string[] = [];

  if (await fileExists(target.mcpConfig)) {
    const mcp = await readJsonFile(target.mcpConfig);
    const updated = removeMcpServer(mcp);
    await writeJsonFile(target.mcpConfig, updated);
    const deleted = await deleteIfEmpty(
      target.mcpConfig,
    );
    log.push(
      `  ${target.mcpConfig}: ` +
      (deleted ? 'removed (empty)' : 'server removed'),
    );
  } else {
    log.push(
      `  ${target.mcpConfig}: not found, skipped`,
    );
  }

  if (await fileExists(target.settings)) {
    const settings = await readJsonFile(target.settings);
    const updated = removePreToolUseHook(settings);
    await writeJsonFile(target.settings, updated);
    await deleteIfEmpty(target.settings);
    log.push(`  ${target.settings}: hook removed`);
  } else {
    log.push(
      `  ${target.settings}: not found, skipped`,
    );
  }

  if (await fileExists(target.localSettings)) {
    const local = await readJsonFile(
      target.localSettings,
    );
    const updated = removePermissions(local);
    await writeJsonFile(target.localSettings, updated);
    await deleteIfEmpty(target.localSettings);
    log.push(
      `  ${target.localSettings}: rules removed`,
    );
  } else {
    log.push(
      `  ${target.localSettings}: not found, skipped`,
    );
  }

  await deleteDirIfEmpty(target.settingsDir);

  return log;
}
