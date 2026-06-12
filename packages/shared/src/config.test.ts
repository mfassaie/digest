import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  getArtefactRoot, getCacheRoot, getLogsDir, getRepoRoot, isDevMode,
} from './config.js';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('config', () => {
  it('defaults the artefact root under ~/.claude/digest', () => {
    delete process.env.DIGEST_ARTEFACT_ROOT;
    expect(getArtefactRoot().replace(/\\/g, '/'))
      .toContain('.claude/digest');
    expect(getCacheRoot().replace(/\\/g, '/')).toContain('.claude/digest/cache');
    expect(getLogsDir().replace(/\\/g, '/')).toContain('.claude/digest/logs');
  });

  it('honours DIGEST_ARTEFACT_ROOT for cache and logs', () => {
    process.env.DIGEST_ARTEFACT_ROOT = join('/tmp', 'mydocs');
    expect(getArtefactRoot()).toBe(join('/tmp', 'mydocs'));
    expect(getCacheRoot()).toBe(join('/tmp', 'mydocs', 'cache'));
    expect(getLogsDir()).toBe(join('/tmp', 'mydocs', 'logs'));
  });

  it('reports dev mode only when DIGEST_REPO_ROOT is set and non-empty', () => {
    delete process.env.DIGEST_REPO_ROOT;
    expect(getRepoRoot()).toBeUndefined();
    expect(isDevMode()).toBe(false);
    process.env.DIGEST_REPO_ROOT = '  ';
    expect(getRepoRoot()).toBeUndefined();
    process.env.DIGEST_REPO_ROOT = '/repo/digest';
    expect(getRepoRoot()).toBe('/repo/digest');
    expect(isDevMode()).toBe(true);
  });
});
