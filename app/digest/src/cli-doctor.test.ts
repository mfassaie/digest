import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function healthyRunner(): CommandRunner {
  return fakeRunner({
    version: { stdout: '29.3.1', code: 0 },
    'image inspect': { code: 0 },
  });
}

const ENV = { ...process.env };
let lines: string[];
let tempDir: string;

beforeEach(async () => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    lines.push(String(msg));
  });
  // Keep the machine's real user config out of the settings checks.
  tempDir = await mkdtemp(join(tmpdir(), 'digest-doctor-'));
  process.env.XDG_CONFIG_HOME = tempDir;
  delete process.env.DIGEST_CONFIG;
});

afterEach(async () => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe('doctor', () => {
  it('passes when docker and the image are available', async () => {
    const code = await doctor(healthyRunner());
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

  it('reports the artefact root, cache, logs and dev mode', async () => {
    process.env.DIGEST_ARTEFACT_ROOT = join(tempDir, 'roots');
    process.env.DIGEST_REPO_ROOT = '/repo/app/digest';
    const code = await doctor(healthyRunner());
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain(`Artefact root: ${join(tempDir, 'roots')}`);
    expect(out).toContain('Cache:');
    expect(out).toContain('Logs:');
    expect(out).toContain('Dev mode: repo /repo/app/digest');
  });

  it('reports built-in defaults and the effective rule table', async () => {
    const code = await doctor(healthyRunner());
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain(
      'OK   Settings: built-in defaults (no settings file), valid',
    );
    expect(out).toContain(
      'Effective type rules (retrieval, parser, runtime, escalation):',
    );
    expect(out).toMatch(/text\/html\s+browser\s+defuddle\s+container\s+browser/);
    expect(out).toMatch(
      /application\/xhtml\+xml\s+browser\s+defuddle\s+container\s+browser/,
    );
    expect(out).toMatch(/\*\/\*\s+http\s+raw\s+container\s+browser/);
  });

  it('reports a DIGEST_CONFIG file and merges it into the table', async () => {
    const file = join(tempDir, 'settings.json');
    await writeFile(file, JSON.stringify({
      types: {
        'application/pdf': {
          retrieval: 'http', parser: 'raw', runtime: 'local',
          escalate: 'none',
        },
      },
    }), 'utf8');
    process.env.DIGEST_CONFIG = file;
    const code = await doctor(healthyRunner());
    const out = lines.join('\n');
    expect(code).toBe(0);
    expect(out).toContain(`OK   Settings: ${file} (DIGEST_CONFIG), valid`);
    // The effective table carries both the defaults and the override.
    expect(out).toMatch(/text\/html\s+browser\s+defuddle\s+container\s+browser/);
    expect(out).toMatch(/application\/pdf\s+http\s+raw\s+local\s+none/);
  });

  it('fails on an invalid settings file and omits the rule table', async () => {
    const file = join(tempDir, 'settings.json');
    // runtime 'local' composed onto text/html (built-in retrieval
    // 'browser') violates browser => container at validation time.
    await writeFile(file, JSON.stringify({
      types: { 'text/html': { runtime: 'local' } },
    }), 'utf8');
    process.env.DIGEST_CONFIG = file;
    const code = await doctor(healthyRunner());
    const out = lines.join('\n');
    expect(code).toBe(1);
    expect(out).toContain('FAIL Settings:');
    expect(out).toContain("invalid effective rule for 'text/html'");
    expect(out).not.toContain('Effective type rules');
    expect(out).toContain('Some checks failed.');
  });
});
