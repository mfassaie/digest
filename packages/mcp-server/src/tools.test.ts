import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// Via the package barrel so the public surface is what gets exercised.
import { createServer, type ServerDeps } from './index.js';
import { createArtefactStore } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

// Drive the registered tools through a real (in-memory) MCP client, so
// the zod schemas, enum constraints and defaults run, not just the
// handlers.

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'digest-tools-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';

function testDeps(): ServerDeps {
  return {
    store: createArtefactStore(root),
    settings: DEFAULT_SETTINGS,
    fetchImpl: async () => new Response('# Guide\nIntro.\n', {
      status: 200, headers: { 'content-type': 'text/markdown' },
    }),
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
  it('lists the new tool names only', async () => {
    const { server, client } = await connectedClient(testDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort())
      .toEqual(['fetch_file', 'read_document']);
    expect(server.server.getClientVersion()?.name).toBe('test-client');
    await client.close();
  });

  it('defaults apply: chunk_mode none, read_mode all', async () => {
    const deps = testDeps();
    const { client } = await connectedClient(deps);

    const fetched = await client.callTool({
      name: 'fetch_file', arguments: { uri: MD_URL },
    });
    expect(textOf(fetched)).toContain('"type": "file"');

    const read = await client.callTool({
      name: 'read_document', arguments: { resource: MD_URL },
    });
    const body = JSON.parse(textOf(read)) as {
      document: { sections?: unknown; summary?: string };
    };
    expect(body.document.sections).toBeTruthy();
    await client.close();
  });

  it('rejects an out-of-enum read_mode at the schema layer', async () => {
    const { client } = await connectedClient(testDeps());
    const result = await client.callTool({
      name: 'read_document',
      arguments: { resource: MD_URL, read_mode: 'everything' },
    }) as { isError?: boolean };
    expect(result.isError).toBe(true);
    await client.close();
  });
});
