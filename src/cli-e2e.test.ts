import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const BINARY = join(process.cwd(), 'dist', 'index.js');
const NODE = process.execPath;

describe('cli e2e', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wfp-e2e-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('install in a project dir exits 0 and creates .mcp.json', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    );

    const { stdout, stderr } = await execFileAsync(
      NODE, [BINARY, 'install'],
      { cwd: tempDir },
    );

    const combined = stdout + stderr;
    expect(combined).toContain('Installing');
    expect(combined).toContain('Done');

    await access(join(tempDir, '.mcp.json'));
  });

  it('unknown subcommand prints usage and exits 1', async () => {
    try {
      await execFileAsync(NODE, [BINARY, 'bogus']);
      expect.unreachable('should have exited with code 1');
    } catch (err: unknown) {
      const e = err as {
        code: number;
        stdout: string;
        stderr: string;
      };
      expect(e.code).toBe(1);
      expect(e.stderr).toContain('Unknown command: bogus');
      expect(e.stderr).toContain('Usage:');
    }
  });

  it('--help prints usage and exits 0', async () => {
    const { stderr } = await execFileAsync(
      NODE, [BINARY, '--help'],
    );
    expect(stderr).toContain('Usage:');
  });

  it('--version prints a version string and exits 0', async () => {
    const { stdout } = await execFileAsync(
      NODE, [BINARY, '--version'],
    );
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('no args starts MCP server (process stays alive)', async () => {
    const child = spawn(NODE, [BINARY], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const alive = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(!child.killed && child.exitCode === null);
        child.kill();
      }, 500);

      child.on('exit', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });

    expect(alive).toBe(true);
  });
});
