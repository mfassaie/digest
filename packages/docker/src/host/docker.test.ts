import { describe, it, expect } from 'vitest';
import {
  detectDocker, imagePresent, ensureContainer, realRunner,
  DockerUnavailableError, type CommandRunner,
} from './docker.js';

type Reply = { stdout?: string; stderr?: string; code?: number };

// Fake runner that matches on the docker subcommand and records calls.
function fakeRunner(
  replies: Record<string, Reply>,
): CommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async exec(_cmd, args) {
      calls.push(args);
      const key = args[0] === 'image' ? 'image inspect'
        : args.slice(0, 1).join(' ');
      const r = replies[key] ?? replies[args[0]] ?? { code: 1 };
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 };
    },
  };
}

describe('detectDocker', () => {
  it('passes when docker version returns a version', async () => {
    const r = fakeRunner({ version: { stdout: '29.3.1', code: 0 } });
    await expect(detectDocker(r)).resolves.toBeUndefined();
  });
  it('throws DockerUnavailableError when docker missing', async () => {
    const r = fakeRunner({ version: { code: 1, stderr: 'not found' } });
    await expect(detectDocker(r)).rejects.toBeInstanceOf(
      DockerUnavailableError,
    );
  });
});

describe('imagePresent', () => {
  it('true when inspect succeeds', async () => {
    const r = fakeRunner({ 'image inspect': { code: 0 } });
    expect(await imagePresent(r)).toBe(true);
  });
  it('false when inspect fails', async () => {
    const r = fakeRunner({ 'image inspect': { code: 1 } });
    expect(await imagePresent(r)).toBe(false);
  });
});

describe('ensureContainer', () => {
  const healthy = async () => ({ cdpConnected: true });

  it('runs a new container when absent and returns mapped baseUrl', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { code: 1 }, // absent
      run: { stdout: 'id', code: 0 },
      port: { stdout: '127.0.0.1:32811', code: 0 },
    });
    const { baseUrl } = await ensureContainer(r, { healthCheck: healthy });
    expect(baseUrl).toBe('http://127.0.0.1:32811');
    const runCall = r.calls.find((c) => c[0] === 'run')!;
    expect(runCall).toContain('--init');
    expect(runCall.join(' ')).toContain('127.0.0.1:0:8932');
    // Document-root-agnostic: no bind-mount.
    expect(runCall.join(' ')).not.toContain('-v');
  });

  it('starts a stopped container instead of running a new one', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'false', code: 0 }, // stopped
      start: { code: 0 },
      port: { stdout: '127.0.0.1:5000', code: 0 },
    });
    await ensureContainer(r, { healthCheck: healthy });
    expect(r.calls.some((c) => c[0] === 'start')).toBe(true);
    expect(r.calls.some((c) => c[0] === 'run')).toBe(false);
  });

  it('reuses a running container', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'true', code: 0 }, // running
      port: { stdout: '127.0.0.1:6000', code: 0 },
    });
    await ensureContainer(r, { healthCheck: healthy });
    expect(r.calls.some((c) => c[0] === 'run' || c[0] === 'start')).toBe(false);
  });

  it('throws when the image is missing', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 1 },
    });
    await expect(ensureContainer(r, {
      healthCheck: healthy,
    })).rejects.toBeInstanceOf(DockerUnavailableError);
  });

  it('throws when docker run fails', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { code: 1 }, // absent
      run: { stderr: 'port already allocated', code: 125 },
    });
    await expect(ensureContainer(r, { healthCheck: healthy }))
      .rejects.toThrow('port already allocated');
  });

  it('throws when docker start fails on a stopped container', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'false', code: 0 }, // stopped
      start: { stderr: 'cannot start', code: 1 },
    });
    await expect(ensureContainer(r, { healthCheck: healthy }))
      .rejects.toThrow('cannot start');
  });

  it('throws when the mapped port cannot be determined', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'true', code: 0 }, // running
      port: { stdout: 'garbage', code: 0 },
    });
    await expect(ensureContainer(r, { healthCheck: healthy }))
      .rejects.toThrow('mapped port');
  });

  it('retries an initially unhealthy container until it reports healthy', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'true', code: 0 },
      port: { stdout: '127.0.0.1:7000', code: 0 },
    });
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNREFUSED');
      if (calls === 2) return { cdpConnected: false, status: 'starting' };
      return { cdpConnected: true };
    };
    const { baseUrl } = await ensureContainer(r, { healthCheck: flaky });
    expect(baseUrl).toBe('http://127.0.0.1:7000');
    expect(calls).toBe(3);
  }, 10_000);
});

describe('realRunner', () => {
  it('executes a real command and captures stdout', async () => {
    const res = await realRunner.exec(
      process.execPath, ['--version'], 10_000,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^v\d+/);
  });

  it('reports a non-zero code for a missing binary', async () => {
    const res = await realRunner.exec(
      'definitely-not-a-real-binary-xyz', [], 5_000,
    );
    expect(res.code).not.toBe(0);
  });
});
