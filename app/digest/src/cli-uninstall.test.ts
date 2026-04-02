import { describe, it, expect } from 'vitest';
import {
  removeMcpServer,
  removePreToolUseHook,
  removePermissions,
} from './cli-uninstall.js';

describe('removeMcpServer', () => {
  it('removes mcpServers key when only digest present', () => {
    const config = {
      mcpServers: {
        'digest': { command: 'node', args: ['dist/index.js'] },
      },
    };
    const result = removeMcpServer(config);
    expect(result).not.toHaveProperty('mcpServers');
  });

  it('removes legacy webfetch-plus key as well', () => {
    const config = {
      mcpServers: {
        'webfetch-plus': { command: 'node', args: ['dist/index.js'] },
      },
    };
    const result = removeMcpServer(config);
    expect(result).not.toHaveProperty('mcpServers');
  });

  it('removes digest and legacy, preserves other servers', () => {
    const config = {
      mcpServers: {
        'digest': { command: 'node', args: ['dist/index.js'] },
        'webfetch-plus': { command: 'node', args: ['dist/old.js'] },
        'other-server': { command: 'python', args: ['server.py'] },
      },
    };
    const result = removeMcpServer(config);
    expect(result.mcpServers).toEqual({
      'other-server': { command: 'python', args: ['server.py'] },
    });
  });

  it('returns unchanged config when no mcpServers key', () => {
    const config = { someOtherKey: 'value' };
    const result = removeMcpServer(config);
    expect(result).toEqual({ someOtherKey: 'value' });
  });

  it('does not mutate the original config', () => {
    const config = {
      mcpServers: {
        'digest': { command: 'node' },
        'other': { command: 'python' },
      },
    };
    const original = JSON.parse(JSON.stringify(config));
    removeMcpServer(config);
    expect(config).toEqual(original);
  });
});

describe('removePreToolUseHook', () => {
  it('removes hooks key when only WebFetch hook present', () => {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'WebFetch', hook: 'deny' },
        ],
      },
    };
    const result = removePreToolUseHook(config);
    expect(result).not.toHaveProperty('hooks');
  });

  it('removes only WebFetch hook, preserves others', () => {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'WebFetch', hook: 'deny' },
          { matcher: 'Bash', hook: 'ask' },
        ],
      },
    };
    const result = removePreToolUseHook(config);
    expect(result.hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash', hook: 'ask' }],
    });
  });

  it('preserves other hook types when removing WebFetch', () => {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'WebFetch', hook: 'deny' },
        ],
        PostToolUse: [
          { matcher: 'Bash', hook: 'log' },
        ],
      },
    };
    const result = removePreToolUseHook(config);
    expect(result.hooks).toEqual({
      PostToolUse: [{ matcher: 'Bash', hook: 'log' }],
    });
  });

  it('returns unchanged config when no hooks key', () => {
    const config = { someOtherKey: 'value' };
    const result = removePreToolUseHook(config);
    expect(result).toEqual({ someOtherKey: 'value' });
  });

  it('does not mutate the original config', () => {
    const config = {
      hooks: {
        PreToolUse: [
          { matcher: 'WebFetch', hook: 'deny' },
        ],
      },
    };
    const original = JSON.parse(JSON.stringify(config));
    removePreToolUseHook(config);
    expect(config).toEqual(original);
  });
});

describe('removePermissions', () => {
  it('removes permissions key when only digest entries', () => {
    const config = {
      permissions: {
        deny: ['WebFetch'],
        allow: [
          'mcp__digest__fetch',
          'mcp__digest__read',
        ],
      },
    };
    const result = removePermissions(config);
    expect(result).not.toHaveProperty('permissions');
  });

  it('removes legacy webfetch-plus allow rule too', () => {
    const config = {
      permissions: {
        deny: ['WebFetch'],
        allow: ['mcp__webfetch-plus__webfetch_plus'],
      },
    };
    const result = removePermissions(config);
    expect(result).not.toHaveProperty('permissions');
  });

  it('removes only digest entries, preserves others', () => {
    const config = {
      permissions: {
        deny: ['WebFetch', 'Bash'],
        allow: [
          'mcp__digest__fetch',
          'mcp__digest__read',
          'Read',
        ],
      },
    };
    const result = removePermissions(config);
    expect(result.permissions).toEqual({
      deny: ['Bash'],
      allow: ['Read'],
    });
  });

  it('removes deny key when only WebFetch deny present', () => {
    const config = {
      permissions: {
        deny: ['WebFetch'],
        allow: [
          'mcp__digest__fetch',
          'mcp__digest__read',
          'Read',
        ],
      },
    };
    const result = removePermissions(config);
    expect(result.permissions).toEqual({
      allow: ['Read'],
    });
  });

  it('removes allow key when only MCP allow present', () => {
    const config = {
      permissions: {
        deny: ['WebFetch', 'Bash'],
        allow: [
          'mcp__digest__fetch',
          'mcp__digest__read',
        ],
      },
    };
    const result = removePermissions(config);
    expect(result.permissions).toEqual({
      deny: ['Bash'],
    });
  });

  it('returns unchanged config when no permissions key', () => {
    const config = { someOtherKey: 'value' };
    const result = removePermissions(config);
    expect(result).toEqual({ someOtherKey: 'value' });
  });

  it('does not mutate the original config', () => {
    const config = {
      permissions: {
        deny: ['WebFetch', 'Bash'],
        allow: [
          'mcp__digest__fetch',
          'mcp__digest__read',
        ],
      },
    };
    const original = JSON.parse(JSON.stringify(config));
    removePermissions(config);
    expect(config).toEqual(original);
  });
});
