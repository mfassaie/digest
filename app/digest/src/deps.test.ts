import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the three external modules before importing deps.ts.
vi.mock('@digest/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@digest/shared')>();
  return {
    ...real,
    createArtefactStore: vi.fn(() => ({ paths: { root: '/fake' } })),
    getArtefactRoot: vi.fn(() => '/fake'),
    getLogsDir: vi.fn((r: string) => `${r}/logs`),
    extractiveEngine: { summarise: vi.fn() },
  };
});

vi.mock('@digest/shared/settings', () => ({
  loadSettings: vi.fn(() => ({
    settings: { types: { '*/*': {} } },
    source: 'built-in',
  })),
}));

vi.mock('@digest/docker', () => ({
  ensureContainer: vi.fn(async () => ({ baseUrl: 'http://localhost:9876' })),
  containerFetch: vi.fn(async () => ({
    outcome: 'success' as const,
    body: '<html></html>',
    mime: 'text/html',
    statusCode: 200,
  })),
  realRunner: {},
}));

import { defaultDeps } from './deps.js';
import { ensureContainer, containerFetch } from '@digest/docker';

const ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DIGEST_ARTEFACT_ROOT = '/fake';
  process.env.XDG_CONFIG_HOME = '/tmp/digest-test-cfg';
  delete process.env.DIGEST_CONFIG;
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('defaultDeps', () => {
  it('returns an object with every required field', () => {
    const deps = defaultDeps();
    expect(deps.store).toBeDefined();
    expect(deps.settings).toBeDefined();
    expect(deps.engine).toBeDefined();
    expect(deps.logsDir).toBe('/fake/logs');
    expect(deps.containerTransport).toBeDefined();
    expect(typeof deps.containerTransport!.ensure).toBe('function');
    expect(typeof deps.containerTransport!.fetch).toBe('function');
  });

  it('passes the artefact root through to the store', () => {
    const deps = defaultDeps();
    expect((deps.store as { paths: { root: string } }).paths.root)
      .toBe('/fake');
  });

  it('wires the extractive engine', () => {
    const deps = defaultDeps();
    expect(typeof deps.engine!.summarise).toBe('function');
  });
});

describe('container transport caching', () => {
  it('caches the result of ensure after the first call', async () => {
    const deps = defaultDeps();
    const t = deps.containerTransport!;
    const first = await t.ensure();
    const second = await t.ensure();

    expect(first).toEqual({ baseUrl: 'http://localhost:9876' });
    expect(second).toBe(first);
    expect(ensureContainer).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from ensureContainer', async () => {
    vi.mocked(ensureContainer).mockRejectedValueOnce(
      new Error('Docker not running'),
    );
    const deps = defaultDeps();
    await expect(deps.containerTransport!.ensure())
      .rejects.toThrow('Docker not running');
  });

  it('retries after a failure (cache is not set on error)', async () => {
    vi.mocked(ensureContainer)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ baseUrl: 'http://localhost:1111' });

    const deps = defaultDeps();
    const t = deps.containerTransport!;

    await expect(t.ensure()).rejects.toThrow('transient');
    const result = await t.ensure();
    expect(result).toEqual({ baseUrl: 'http://localhost:1111' });
    expect(ensureContainer).toHaveBeenCalledTimes(2);
  });
});

describe('container transport fetch', () => {
  it('delegates to containerFetch with the given baseUrl and request', async () => {
    const deps = defaultDeps();
    const req = {
      url: 'https://example.com',
      instruction: {
        retrieval: 'browser' as const,
        parser: 'defuddle' as const,
        escalate: 'none' as const,
      },
      timeoutSeconds: 30,
      rawOnly: false,
    };
    const result = await deps.containerTransport!.fetch(
      'http://localhost:9876', req,
    );
    expect(containerFetch).toHaveBeenCalledWith(
      'http://localhost:9876', req,
    );
    expect(result).toEqual({
      outcome: 'success',
      body: '<html></html>',
      mime: 'text/html',
      statusCode: 200,
    });
  });
});
