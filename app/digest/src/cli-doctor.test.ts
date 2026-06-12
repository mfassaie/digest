import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { doctor } from './cli-doctor.js';
import type { CommandRunner } from '@digest/docker';

type Reply = { stdout?: string; stderr?: string; code?: number };

// Fake runner keyed on the docker subcommand, as in docker.test.ts.
function fakeRunner(replies: Record<string, Reply>): CommandRunner {
  return {
    async exec(_cmd, args) {
      const key = args[0] === 'image' ? 'image inspect' : args[0];
      const r = replies[key] ?? { code: 1 };
      return {
        stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0,
      };
    },
  };
}

const ENV = { ...process.env };
let lines: string[];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    lines.push(String(msg));
  });
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe('doctor', () => {
  it('passes when docker and the image are available', async () => {
    const code = await doctor(fakeRunner({
      version: { stdout: '29.3.1', code: 0 },
      'image inspect': { code: 0 },
    }));
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain('OK   Docker: available');
    expect(out).toContain('digest:local present');
    expect(out).toContain('All checks passed.');
  });

  it('fails with a clear hint when docker is unavailable', async () => {
    const code = await doctor(fakeRunner({
      version: { code: 1, stderr: 'not found' },
      'image inspect': { code: 1 },
    }));
    const out = lines.join('\n');
    expect(code).toBe(1);
    expect(out).toContain('FAIL Docker:');
    expect(out).toContain('missing — run `digest setup`');
    expect(out).toContain('Some checks failed.');
  });

  it('reports the document root, cache, logs and dev mode', async () => {
    process.env.DIGEST_REPO_ROOT = '/repo/app/digest';
    const code = await doctor(fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
    }));
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain('Document root:');
    expect(out).toContain('Cache:');
    expect(out).toContain('Logs:');
    expect(out).toContain('Dev mode: repo /repo/app/digest');
  });
});
