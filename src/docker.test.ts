import { describe, it, expect } from 'vitest';
import {
  detectDocker, imagePresent, ensureContainer, DockerUnavailableError,
  type CommandRunner,
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
    const { baseUrl } = await ensureContainer(r, {
      cacheRoot: '/c', healthCheck: healthy,
    });
    expect(baseUrl).toBe('http://127.0.0.1:32811');
    const runCall = r.calls.find((c) => c[0] === 'run')!;
    expect(runCall).toContain('--init');
    expect(runCall.join(' ')).toContain('/c:/data');
    expect(runCall.join(' ')).toContain('127.0.0.1:0:8932');
  });

  it('starts a stopped container instead of running a new one', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { stdout: 'false', code: 0 }, // stopped
      start: { code: 0 },
      port: { stdout: '127.0.0.1:5000', code: 0 },
    });
    await ensureContainer(r, { cacheRoot: '/c', healthCheck: healthy });
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
    await ensureContainer(r, { cacheRoot: '/c', healthCheck: healthy });
    expect(r.calls.some((c) => c[0] === 'run' || c[0] === 'start')).toBe(false);
  });

  it('adds --user on linux', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 0 },
      inspect: { code: 1 },
      run: { code: 0 },
      port: { stdout: '127.0.0.1:7000', code: 0 },
    });
    await ensureContainer(r, {
      cacheRoot: '/c', platform: 'linux', uid: 1000, healthCheck: healthy,
    });
    const runCall = r.calls.find((c) => c[0] === 'run')!;
    expect(runCall.join(' ')).toContain('--user 1000');
  });

  it('throws when the image is missing', async () => {
    const r = fakeRunner({
      version: { stdout: '29', code: 0 },
      'image inspect': { code: 1 },
    });
    await expect(ensureContainer(r, {
      cacheRoot: '/c', healthCheck: healthy,
    })).rejects.toBeInstanceOf(DockerUnavailableError);
  });
});
