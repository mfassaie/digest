import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

// --- Mocks must be registered before any import that triggers service.ts ---

// Fake CdpEngine: isReady resolves to a controllable value.
let cdpReady = true;
vi.mock('./playwright-engine.js', () => ({
  CdpEngine: class {
    async isReady() { return cdpReady; }
  },
}));

// Fake orchestrateFetch: resolves or rejects based on a controllable stub.
let orchestrateStub: (
  engine: unknown, input: unknown,
) => Promise<unknown> = async () => ({
  outcome: 'fetched',
  category: 'html',
  content: { ext: 'html', raw: '', markdown: '# Hello' },
  sections: [],
});
vi.mock('./fetch-orchestrator.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./fetch-orchestrator.js')>();
  return {
    ...orig,
    orchestrateFetch: (engine: unknown, input: unknown) =>
      orchestrateStub(engine, input),
  };
});

// Pick a random port so tests do not collide with a real service.
const TEST_PORT = 0;
vi.stubEnv('SERVICE_PORT', String(TEST_PORT));
vi.stubEnv('DIGEST_VERSION', '0.4.0-test');

// --- Now import the module (triggers server.listen) ---

let baseUrl: string;
let serverModule: typeof import('./service.js');

// We cannot directly access the server handle because it is module-scoped.
// Instead we import the module (which starts listening on port 0) and derive
// the base URL from the OS-assigned port. To shut down we import the server
// reference indirectly: vitest's dynamic import lets us hold the module, but
// the server is not exported. We work around this by patching `createServer`
// to capture the return value.

import { createServer, type Server } from 'node:http';

let capturedServer: Server | undefined;
const origCreateServer = createServer;
vi.mock('node:http', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:http')>();
  return {
    ...mod,
    createServer: (...args: Parameters<typeof mod.createServer>) => {
      const s = mod.createServer(...args);
      capturedServer = s;
      return s;
    },
  };
});

beforeAll(async () => {
  serverModule = await import('./service.js');
  // Wait for the server to be listening.
  await new Promise<void>((resolve) => {
    if (!capturedServer) throw new Error('server not captured');
    if (capturedServer.listening) {
      resolve();
    } else {
      capturedServer.on('listening', resolve);
    }
  });
  const addr = capturedServer!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (capturedServer) {
    await new Promise<void>((r) => capturedServer!.close(() => r()));
  }
});

// --- Tests ---

describe('service /healthz', () => {
  it('returns 200 with version when CDP is ready', async () => {
    cdpReady = true;
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      cdpConnected: true,
      version: '0.4.0-test',
    });
  });

  it('returns 503 when CDP is not ready', async () => {
    cdpReady = false;
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'cdp-unavailable',
      cdpConnected: false,
    });
  });

  it('sets Content-Type to application/json', async () => {
    cdpReady = true;
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});

describe('service POST /fetch', () => {
  it('dispatches valid input and returns 200 on fetched outcome', async () => {
    orchestrateStub = async () => ({
      outcome: 'fetched',
      category: 'html',
      content: { ext: 'html', raw: '', markdown: '# Test' },
      sections: [],
    });
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('fetched');
  });

  it('returns 504 on timeout outcome', async () => {
    orchestrateStub = async () => ({ outcome: 'timeout' });
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/slow' }),
    });
    expect(res.status).toBe(504);
  });

  it('returns 502 on fetch-failed outcome', async () => {
    orchestrateStub = async () => ({
      outcome: 'fetch-failed', reason: 'network error',
    });
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/down' }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.reason).toBe('network error');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{{not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.outcome).toBe('fetch-failed');
    expect(body.reason).toBe('invalid JSON');
  });

  it('returns 400 when url is missing', async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notUrl: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('url required');
  });

  it('returns 400 for a non-object body (e.g. a string)', async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('just a string'),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe('url required');
  });

  it('returns 502 when the engine throws', async () => {
    orchestrateStub = async () => {
      throw new Error('CDP crashed');
    };
    const res = await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.outcome).toBe('fetch-failed');
    expect(body.reason).toBe('CDP crashed');
  });

  it('uses default timeoutSeconds when not provided', async () => {
    let capturedInput: unknown;
    orchestrateStub = async (_engine, input) => {
      capturedInput = input;
      return { outcome: 'fetched', content: {}, sections: [] };
    };
    await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });
    expect((capturedInput as { timeoutSeconds: number }).timeoutSeconds)
      .toBe(30);
  });

  it('passes through instruction field when present', async () => {
    let capturedInput: unknown;
    orchestrateStub = async (_engine, input) => {
      capturedInput = input;
      return { outcome: 'fetched', content: {}, sections: [] };
    };
    const instruction = {
      retrieval: 'browser', parser: 'defuddle', escalate: 'browser',
    };
    await fetch(`${baseUrl}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x.com', instruction }),
    });
    expect((capturedInput as { instruction: unknown }).instruction)
      .toEqual(instruction);
  });
});

describe('service routing', () => {
  it('returns 404 JSON for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not found');
  });

  it('returns 404 for GET /fetch (wrong method)', async () => {
    const res = await fetch(`${baseUrl}/fetch`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for POST /healthz (wrong method)', async () => {
    const res = await fetch(`${baseUrl}/healthz`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
