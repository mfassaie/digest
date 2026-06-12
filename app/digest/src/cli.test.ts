import { describe, it, expect, vi } from 'vitest';
import { parseArgs, printUsage, printVersion } from './cli.js';

describe('parseArgs', () => {
  it('returns install with default project scope', () => {
    const result = parseArgs(['node', 'index.js', 'install']);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'project',
    });
  });

  it('returns install with explicit global scope', () => {
    const result = parseArgs([
      'node', 'index.js', 'install', '--scope', 'global',
    ]);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'global',
    });
  });

  it('returns install with explicit project scope', () => {
    const result = parseArgs([
      'node', 'index.js', 'install', '--scope', 'project',
    ]);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'project',
    });
  });

  it('returns uninstall with default project scope', () => {
    const result = parseArgs([
      'node', 'index.js', 'uninstall',
    ]);
    expect(result).toEqual({
      subcommand: 'uninstall',
      scope: 'project',
    });
  });

  it('returns uninstall with global scope', () => {
    const result = parseArgs([
      'node', 'index.js', 'uninstall', '--scope', 'global',
    ]);
    expect(result).toEqual({
      subcommand: 'uninstall',
      scope: 'global',
    });
  });

  it('returns null when no subcommand given', () => {
    const result = parseArgs(['node', 'index.js']);
    expect(result).toBeNull();
  });

  it('returns null for unknown subcommand', () => {
    const result = parseArgs([
      'node', 'index.js', 'update',
    ]);
    expect(result).toBeNull();
  });

  it('returns null for --help flag', () => {
    const result = parseArgs([
      'node', 'index.js', '--help',
    ]);
    expect(result).toBeNull();
  });

  it('returns null for --version flag', () => {
    const result = parseArgs([
      'node', 'index.js', '--version',
    ]);
    expect(result).toBeNull();
  });

  it('ignores invalid scope value', () => {
    const result = parseArgs([
      'node', 'index.js', 'install', '--scope', 'user',
    ]);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'project',
    });
  });

  it('ignores --scope with no following value', () => {
    const result = parseArgs([
      'node', 'index.js', 'install', '--scope',
    ]);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'project',
    });
  });

  it('captures --artefact-root and --repo values', () => {
    const result = parseArgs([
      'node', 'index.js', 'install',
      '--artefact-root', '/tmp/store', '--repo', '/repo/digest',
    ]);
    expect(result).toEqual({
      subcommand: 'install',
      scope: 'project',
      artefactRoot: '/tmp/store',
      repoRoot: '/repo/digest',
    });
  });
});

describe('printUsage', () => {
  it('prints usage text to stderr', () => {
    const spy = vi.spyOn(console, 'error')
      .mockImplementation(() => {});
    printUsage();
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('Usage: digest');
    expect(output).toContain('setup');
    expect(output).toContain('doctor');
    expect(output).toContain('install');
    expect(output).toContain('uninstall');
    expect(output).toContain('--artefact-root');
    expect(output).toContain('--help');
    expect(output).toContain('--version');
    spy.mockRestore();
  });
});

describe('printVersion', () => {
  it('prints a version string to stdout', () => {
    const spy = vi.spyOn(console, 'log')
      .mockImplementation(() => {});
    printVersion();
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
    spy.mockRestore();
  });

  it('reads the version from package.json, ignoring env vars', () => {
    const spy = vi.spyOn(console, 'log')
      .mockImplementation(() => {});
    const prev = process.env.npm_package_version;
    process.env.npm_package_version = '2.5.0';
    printVersion();
    // Now sourced from package.json at runtime, not the env var.
    expect(spy.mock.calls[0][0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(spy.mock.calls[0][0]).not.toBe('2.5.0');
    process.env.npm_package_version = prev;
    spy.mockRestore();
  });
});
