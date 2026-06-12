import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { setup, type SpawnLike } from './cli-setup.js';

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    logs.push(String(msg));
  });
  vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
    errors.push(String(msg));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Fake child that emits the given event on the next tick.
function fakeSpawn(
  event: 'exit' | 'error', value: number | null | Error,
): SpawnLike & { calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  const fn: SpawnLike = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit(event, value));
    return child;
  };
  return Object.assign(fn, { calls });
}

describe('setup', () => {
  it('builds the image and reports success on exit 0', async () => {
    const spawnFn = fakeSpawn('exit', 0);
    const code = await setup(spawnFn);
    expect(code).toBe(0);
    expect(spawnFn.calls[0].cmd).toBe('docker');
    expect(spawnFn.calls[0].args.slice(0, 3))
      .toEqual(['build', '-t', 'digest:local']);
    const out = logs.join('\n');
    expect(out).toContain('Building digest:local');
    expect(out).toContain('local use only');
    expect(out).toContain('Done. digest:local built.');
  });

  it('returns the docker build exit code on failure', async () => {
    const code = await setup(fakeSpawn('exit', 3));
    expect(code).toBe(3);
    expect(logs.join('\n')).not.toContain('Done.');
  });

  it('returns 1 with a hint when docker cannot start', async () => {
    const code = await setup(fakeSpawn('error', new Error('ENOENT')));
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('Is Docker installed and running?');
  });

  it('treats a null exit code as failure', async () => {
    const code = await setup(fakeSpawn('exit', null));
    expect(code).toBe(1);
  });
});
