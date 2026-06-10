import { describe, it, expect } from 'vitest';
import {
  addMcpServer,
  addPreToolUseHook,
  addPermissions,
  buildHookCommand,
  buildMcpEntry,
} from './cli-install.js';

const MCP_ENTRY = buildMcpEntry();

describe('buildHookCommand', () => {
  const command = buildHookCommand();

  it('starts with "node -e"', () => {
    expect(command.startsWith('node -e')).toBe(true);
  });

  it('does not contain "echo"', () => {
    expect(command).not.toContain('echo');
  });

  it('references PreToolUse as hookEventName', () => {
    expect(command).toContain('PreToolUse');
  });

  it('references deny as permissionDecision', () => {
    expect(command).toContain('deny');
  });

  it('references mcp__digest__fetch in denial reason', () => {
    expect(command).toContain(
      'mcp__digest__fetch',
    );
  });

  it('produces valid JSON when evaluated', () => {
    const match = command.match(
      /process\.stdout\.write\((.+)\)"/,
    );
    expect(match).not.toBeNull();
    const inner = JSON.parse(match![1]) as string;
    const parsed = JSON.parse(inner) as Record<
      string, unknown
    >;
    expect(parsed).toHaveProperty(
      'hookSpecificOutput.hookEventName',
      'PreToolUse',
    );
    expect(parsed).toHaveProperty(
      'hookSpecificOutput.permissionDecision',
      'deny',
    );
    expect(parsed).toHaveProperty(
      'hookSpecificOutput.permissionDecisionReason',
    );
    const reason = (
      parsed as {
        hookSpecificOutput: {
          permissionDecisionReason: string;
        };
      }
    ).hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain(
      'mcp__digest__fetch',
    );
  });
});

describe('addMcpServer', () => {
  it('adds mcpServers to empty config', () => {
    const result = addMcpServer({});
    expect(result).toEqual({
      mcpServers: { 'digest': MCP_ENTRY },
    });
  });

  it('preserves existing servers', () => {
    const config = {
      mcpServers: {
        'other-server': { command: 'other', args: [] },
      },
    };
    const result = addMcpServer(config);
    expect(result.mcpServers).toEqual({
      'other-server': { command: 'other', args: [] },
      'digest': MCP_ENTRY,
    });
  });

  it('removes legacy webfetch-plus and writes digest entry', () => {
    const config = {
      mcpServers: {
        'webfetch-plus': { command: 'old', args: ['--old'] },
      },
    };
    const result = addMcpServer(config);
    const servers = result.mcpServers as Record<string, unknown>;
    expect(servers['webfetch-plus']).toBeUndefined();
    expect(servers['digest']).toEqual(MCP_ENTRY);
  });

  it('is idempotent (running twice produces same result)', () => {
    const first = addMcpServer({});
    const second = addMcpServer(first);
    expect(second).toEqual(first);
  });

  it('preserves non-mcpServers config keys', () => {
    const config = { someSetting: true };
    const result = addMcpServer(config);
    expect(result.someSetting).toBe(true);
    expect(result.mcpServers).toBeDefined();
  });
});

describe('addPreToolUseHook', () => {
  const expectedHook = {
    matcher: 'WebFetch',
    hooks: [{
      type: 'command',
      command: buildHookCommand(),
    }],
  };

  it('adds hooks to empty config', () => {
    const result = addPreToolUseHook({});
    expect(result.hooks).toEqual({
      PreToolUse: [expectedHook],
    });
  });

  it('preserves existing hooks for different matchers', () => {
    const otherHook = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo hi' }],
    };
    const config = {
      hooks: { PreToolUse: [otherHook] },
    };
    const result = addPreToolUseHook(config);
    const preToolUse = (result.hooks as Record<string, unknown>)
      .PreToolUse as unknown[];
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse[0]).toEqual(otherHook);
    expect(preToolUse[1]).toEqual(expectedHook);
  });

  it('preserves hooks under other event names', () => {
    const config = {
      hooks: {
        PostToolUse: [{ matcher: 'Foo', hooks: [] }],
      },
    };
    const result = addPreToolUseHook(config);
    const hooks = result.hooks as Record<string, unknown>;
    expect(hooks.PostToolUse).toEqual([
      { matcher: 'Foo', hooks: [] },
    ]);
    expect(hooks.PreToolUse).toEqual([expectedHook]);
  });

  it('is idempotent (only one WebFetch entry after two runs)', () => {
    const first = addPreToolUseHook({});
    const second = addPreToolUseHook(first);
    const preToolUse = (second.hooks as Record<string, unknown>)
      .PreToolUse as unknown[];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]).toEqual(expectedHook);
  });

  it('replaces stale WebFetch hook with current one', () => {
    const staleHook = {
      matcher: 'WebFetch',
      hooks: [{ type: 'command', command: 'echo old' }],
    };
    const config = {
      hooks: { PreToolUse: [staleHook] },
    };
    const result = addPreToolUseHook(config);
    const preToolUse = (result.hooks as Record<string, unknown>)
      .PreToolUse as unknown[];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]).toEqual(expectedHook);
  });
});

describe('addPermissions', () => {
  it('adds permissions to empty config', () => {
    const result = addPermissions({});
    expect(result.permissions).toEqual({
      deny: ['WebFetch'],
      allow: [
        'mcp__digest__fetch',
        'mcp__digest__read',
      ],
    });
  });

  it('preserves existing deny/allow entries', () => {
    const config = {
      permissions: {
        deny: ['SomeTool'],
        allow: ['OtherTool'],
      },
    };
    const result = addPermissions(config);
    const perms = result.permissions as Record<string, unknown>;
    expect(perms.deny).toEqual(['SomeTool', 'WebFetch']);
    expect(perms.allow).toEqual([
      'OtherTool',
      'mcp__digest__fetch',
      'mcp__digest__read',
    ]);
  });

  it('is idempotent (no duplicates after two runs)', () => {
    const first = addPermissions({});
    const second = addPermissions(first);
    const perms = second.permissions as Record<string, unknown>;
    expect(perms.deny).toEqual(['WebFetch']);
    expect(perms.allow).toEqual([
      'mcp__digest__fetch',
      'mcp__digest__read',
    ]);
  });

  it('preserves other permission keys', () => {
    const config = {
      permissions: { scope: 'project' },
    };
    const result = addPermissions(config);
    const perms = result.permissions as Record<string, unknown>;
    expect(perms.scope).toBe('project');
    expect(perms.deny).toEqual(['WebFetch']);
    expect(perms.allow).toEqual([
      'mcp__digest__fetch',
      'mcp__digest__read',
    ]);
  });

  it('preserves non-permissions config keys', () => {
    const config = { otherKey: 42 };
    const result = addPermissions(config);
    expect(result.otherKey).toBe(42);
    expect(result.permissions).toBeDefined();
  });
});
