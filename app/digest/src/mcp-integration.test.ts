import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, close } from 'mcp-testing-kit';
import { createServer, type ServerDeps } from '@digest/mcp-server';
import {
  extractiveEngine,
  type ContainerFetchResponse, type Section,
} from '@digest/shared';
import { defaultDeps } from './deps.js';
import { getVersion } from './version.js';

// Integration: drive the wired MCP server over the protocol (mcp-testing-kit)
// with a fake container transport — schema validation, tool dispatch and
// host-side cache writing all run for real.

let cacheRoot: string;
beforeEach(() => { cacheRoot = mkdtempSync(join(tmpdir(), 'falk-mcp-')); });
afterEach(() => { rmSync(cacheRoot, { recursive: true, force: true }); });

const sections: Section[] = [
  { level: 1, title: 'Title', slug: 'title', startLine: 1, endLine: 3 },
  { level: 2, title: 'Install', slug: 'install', startLine: 4, endLine: 6 },
];

const fetched: ContainerFetchResponse = {
  outcome: 'fetched', status: 200, finalUrl: 'https://ex.com/p',
  contentType: 'text/html', category: 'html',
  meta: { title: 'Doc Title' },
  sections,
  content: {
    ext: 'html',
    raw: Buffer.from('<html/>', 'utf8').toString('base64'),
    markdown: '# Title\nIntro.\n\n## Install\nRun it.\n',
  },
};

function testDeps(): ServerDeps {
  return {
    transport: {
      ensure: async () => ({ baseUrl: 'http://stub' }),
      fetch: async () => fetched,
    },
    cacheRoot,
    engine: extractiveEngine,
  };
}

function textOf(result: { [x: string]: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

// mcp-testing-kit's declarations resolve the SDK's CJS types while this
// package sees the ESM ones; the runtime object is the same, so bridge the
// nominal (private-property) mismatch with one cast.
type KitServer = Parameters<typeof connect>[0];
function rawServer(s: { server: unknown }): KitServer {
  return s.server as KitServer;
}

// mcp-testing-kit 0.2.0 resolves one response per connection, so each
// request gets a fresh server + connection (deps carry the shared state).
async function callOnce(
  deps: ServerDeps,
  run: (client: ReturnType<typeof connect>) => Promise<unknown>,
): Promise<unknown> {
  const server = createServer(deps, getVersion());
  const client = connect(rawServer(server));
  try {
    return await run(client);
  } finally {
    close(rawServer(server));
  }
}

describe('MCP server over the protocol', () => {
  it('lists the fetch and read tools', async () => {
    const result = await callOnce(
      testDeps(), (c) => c.listTools(),
    ) as { tools?: { name?: string }[] };
    const names = (result.tools ?? []).map((t) => t.name);
    expect(names).toContain('fetch');
    expect(names).toContain('read');
  });

  it('fetch then read works end-to-end through tool calls', async () => {
    const deps = testDeps();
    const got = await callOnce(
      deps, (c) => c.callTool('fetch', { uri: 'https://ex.com/p' }),
    ) as { [x: string]: unknown };
    expect(textOf(got)).toContain('Doc Title');
    expect(textOf(got)).toContain('Sections (2)');

    // A second server instance over the same cache root serves the read:
    // the cache written by fetch is durable host-side state.
    const read = await callOnce(
      deps, (c) => c.callTool('read', {
        uri: 'https://ex.com/p', mode: 'sections', section: 'install',
      }),
    ) as { [x: string]: unknown };
    expect(textOf(read)).toContain('Run it.');
  });

  it('read on an uncached url returns an isError result', async () => {
    const read = await callOnce(
      testDeps(), (c) => c.callTool('read', { uri: 'https://ex.com/none' }),
    ) as { [x: string]: unknown };
    expect(read.isError).toBe(true);
    expect(textOf(read)).toContain('fetch first');
  });
});

describe('defaultDeps wiring', () => {
  it('builds the production deps shape', () => {
    const deps = defaultDeps();
    expect(typeof deps.transport.ensure).toBe('function');
    expect(typeof deps.transport.fetch).toBe('function');
    expect(deps.cacheRoot.length).toBeGreaterThan(0);
    expect(deps.engine).toBe(extractiveEngine);
    expect(typeof deps.onContainerReady).toBe('function');
  });
});
