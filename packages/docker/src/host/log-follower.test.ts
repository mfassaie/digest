import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter, Readable } from 'node:stream';

// --- Mocks ---

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const openDocServiceLogMock = vi.fn();
const getLogsDirMock = vi.fn();
const followLinesAsJsonlMock = vi.fn();
vi.mock('@digest/shared', () => ({
  followLinesAsJsonl: followLinesAsJsonlMock,
  getLogsDir: getLogsDirMock,
  openDocServiceLog: openDocServiceLogMock,
}));

vi.mock('./docker.js', () => ({ CONTAINER: 'digest-test' }));

// Helper: build a fake ChildProcess with stdout/stderr streams and an
// EventEmitter for lifecycle events (error, exit).
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    unref: ReturnType<typeof vi.fn>;
  };
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.unref = vi.fn();
  return child;
}

// We need a fresh module import per test because the module has a
// `followerStarted` flag that persists across calls.
async function freshImport() {
  const path = './log-follower.js';
  // Force vitest to re-evaluate the module.
  vi.resetModules();
  // Re-register mocks after resetModules (they were cleared).
  vi.doMock('node:child_process', () => ({ spawn: spawnMock }));
  vi.doMock('@digest/shared', () => ({
    followLinesAsJsonl: followLinesAsJsonlMock,
    getLogsDir: getLogsDirMock,
    openDocServiceLog: openDocServiceLogMock,
  }));
  vi.doMock('./docker.js', () => ({ CONTAINER: 'digest-test' }));
  return import(path);
}

beforeEach(() => {
  vi.clearAllMocks();
  getLogsDirMock.mockReturnValue('/tmp/logs');
  openDocServiceLogMock.mockReturnValue({ write: vi.fn() });
});

describe('startBrowserLogFollower', () => {
  it('spawns docker logs with correct arguments', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const mod = await freshImport();
    mod.startBrowserLogFollower();

    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      ['logs', '-f', '--tail', '0', 'digest-test'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('pipes stdout and stderr to followLinesAsJsonl', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const writer = { write: vi.fn() };
    openDocServiceLogMock.mockReturnValue(writer);

    const mod = await freshImport();
    mod.startBrowserLogFollower();

    expect(followLinesAsJsonlMock).toHaveBeenCalledTimes(2);
    expect(followLinesAsJsonlMock).toHaveBeenCalledWith(
      child.stdout, writer, { stream: 'stdout' },
    );
    expect(followLinesAsJsonlMock).toHaveBeenCalledWith(
      child.stderr, writer, { stream: 'stderr' },
    );
  });

  it('unrefs the child process so it does not block exit', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const mod = await freshImport();
    mod.startBrowserLogFollower();

    expect(child.unref).toHaveBeenCalled();
  });

  it('is idempotent: second call does not spawn again', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const mod = await freshImport();
    mod.startBrowserLogFollower();
    mod.startBrowserLogFollower();

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('resets the guard when spawn emits an error', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const mod = await freshImport();
    mod.startBrowserLogFollower();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // Simulate an error event on the child.
    child.emit('error', new Error('spawn failed'));

    // A fresh second child for the retry call.
    const child2 = fakeChild();
    spawnMock.mockReturnValue(child2);

    // After error the guard should be reset, allowing a new spawn.
    mod.startBrowserLogFollower();
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('resets guard on child exit and allows re-spawn', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const mod = await freshImport();
    mod.startBrowserLogFollower();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // Simulate the child process exiting.
    child.emit('exit', 0, null);

    // Guard should be reset, allowing a new spawn.
    const child2 = fakeChild();
    spawnMock.mockReturnValue(child2);
    mod.startBrowserLogFollower();
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('stops re-spawning after 3 exits within 60 seconds', async () => {
    vi.useFakeTimers();
    try {
      const mod = await freshImport();
      const baseTime = 1_000_000;
      vi.setSystemTime(baseTime);

      // Exit the follower 3 times within 60s.
      for (let i = 0; i < 3; i++) {
        const child = fakeChild();
        spawnMock.mockReturnValue(child);
        mod.startBrowserLogFollower();
        vi.setSystemTime(baseTime + (i + 1) * 5_000);
        child.emit('exit', 1, null);
      }

      expect(spawnMock).toHaveBeenCalledTimes(3);

      // 4th call should be suppressed by the crash-loop guard.
      const child4 = fakeChild();
      spawnMock.mockReturnValue(child4);
      mod.startBrowserLogFollower();
      expect(spawnMock).toHaveBeenCalledTimes(3);

      // Advance past the 60s window so all 3 exits age out.
      // Exits occurred at +5s, +10s, +15s; need > 75s from base.
      vi.setSystemTime(baseTime + 76_000);
      const child5 = fakeChild();
      spawnMock.mockReturnValue(child5);
      mod.startBrowserLogFollower();
      expect(spawnMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the guard when openDocServiceLog throws', async () => {
    openDocServiceLogMock.mockImplementation(() => {
      throw new Error('cannot open log');
    });

    const mod = await freshImport();
    // Should not throw (caught internally).
    mod.startBrowserLogFollower();

    // Guard should be reset so a subsequent call retries.
    openDocServiceLogMock.mockReturnValue({ write: vi.fn() });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    mod.startBrowserLogFollower();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
