import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// Via the package barrel so the public surface is what gets exercised.
import { createServer, type ServerDeps } from './index.js';
import {
  extractiveEngine,
  type ContainerFetchResponse, type Section,
} from '@digest/shared';

// Drive the registered tools through a real (in-memory) MCP client, so the
// zod schemas, defaults and tool callbacks run, not just the handlers.

let cacheRoot: string;
beforeEach(() => { cacheRoot = mkdtempSync(join(tmpdir(), 'falk-tools-')); });
afterEach(() => { rmSync(cacheRoot, { recursive: true, force: true }); });

const sections: Section[] = [
  { level: 1, title: 'Title', slug: 'title', startLine: 1, endLine: 2 },
];

const fetched: ContainerFetchResponse = {
  outcome: 'fetched', status: 200, finalUrl: 'https://ex.com/p',
  contentType: 'text/html', category: 'html',
  meta: { title: 'Doc Title' },
  sections,
  content: {
    ext: 'html',
    raw: Buffer.from('<html/>', 'utf8').toString('base64'),
    markdown: '# Title\nIntro.\n',
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

async function connectedClient(deps: ServerDeps) {
  const server = createServer(deps, '9.9.9');
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { server, client };
}

function textOf(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  return r.content[0].text;
}

describe('registered tools over an in-memory MCP connection', () => {
  it('lists fetch and read with the server version', async () => {
    const { server, client } = await connectedClient(testDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['fetch', 'read']);
    expect(server.server.getClientVersion()?.name).toBe('test-client');
    await client.close();
  });

  it('fetch tool fetches and read tool serves the cache', async () => {
    const deps = testDeps();
    const { client } = await connectedClient(deps);

    const got = await client.callTool({
      name: 'fetch', arguments: { uri: 'https://ex.com/p' },
    });
    expect(textOf(got)).toContain('Doc Title');

    const read = await client.callTool({
      name: 'read', arguments: { uri: 'https://ex.com/p', mode: 'full' },
    });
    expect(textOf(read)).toContain('# Title');
    await client.close();
  });
});
