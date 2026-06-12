import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logLine } from './logging.js';

const ENV = { ...process.env };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'falk-log-'));
  process.env.DIGEST_DOCUMENT_ROOT = root;
});

afterEach(() => {
  process.env = { ...ENV };
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('logLine', () => {
  it('writes the line to stderr and appends to digest-server.log', () => {
    const stderr = vi.spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    logLine('info', 'hello world');
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0][0])).toContain('[info] hello world');
    const logged = readFileSync(
      join(root, 'logs', 'digest-server.log'), 'utf8',
    );
    expect(logged).toContain('[info] hello world');
  });

  it('never throws when the log dir cannot be created', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // NUL byte is invalid in paths on all platforms, so mkdir fails.
    process.env.DIGEST_DOCUMENT_ROOT = join(root, 'bad\0dir');
    expect(() => logLine('error', 'still fine')).not.toThrow();
  });
});
