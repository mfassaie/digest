import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, close } from 'mcp-testing-kit';
import { createServer } from './server.js';
import type { ServerDeps } from './deps.js';
import {
  artefactId, createArtefactStore,
} from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';

// Integration over the MCP protocol (mcp-testing-kit): schema validation,
// tool dispatch and the artefact store all run for real with a fake
// network.

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'digest-srv-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const MD_URL = 'https://ex.com/guide.md';
const MD = '# Guide\n\nIntro.\n\n## Install\n\nRun it.\n';

function testDeps(): ServerDeps {
  return {
    store: createArtefactStore(root),
    settings: DEFAULT_SETTINGS,
    fetchImpl: async () => new Response(MD, {
      status: 200, headers: { 'content-type': 'text/markdown' },
    }),
  };
}

function textOf(result: { [x: string]: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

// mcp-testing-kit's declarations resolve the SDK's CJS types while this
// package sees the ESM ones; the runtime object is the same, so bridge the
// nominal mismatch with one cast.
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
  const server = createServer(deps, '9.9.9');
  const client = connect(rawServer(server));
  try {
    return await run(client);
  } finally {
    close(rawServer(server));
  }
}

describe('the registered tool surface', () => {
  it('registers exactly fetch_file and read_document', async () => {
    const result = await callOnce(
      testDeps(), (c) => c.listTools(),
    ) as { tools?: { name?: string }[] };
    const names = (result.tools ?? []).map((t) => t.name).sort();
    // The old fetch/read tools are gone (plan M4). M5 adds read_section,
    // M6 adds write_section.
    expect(names).toEqual([
      'fetch_file', 'read_document', 'read_section', 'write_section',
    ]);
  });

  it('fetch_file then read_document works over the protocol', async () => {
    const deps = testDeps();
    const fetched = await callOnce(
      deps, (c) => c.callTool('fetch_file', { uri: MD_URL }),
    ) as { [x: string]: unknown };
    expect(fetched.isError).toBeFalsy();
    const digest = JSON.parse(textOf(fetched)) as {
      id: string; type: string;
    };
    expect(digest.type).toBe('file');
    expect(digest.id).toBe(artefactId(MD_URL, 'file'));

    // A fresh server over the same store serves the read: artefacts are
    // durable host-side state.
    const read = await callOnce(
      deps, (c) => c.callTool('read_document', { resource: MD_URL }),
    ) as { [x: string]: unknown };
    const body = JSON.parse(textOf(read)) as {
      type: string; source_changed: boolean;
      document: { sections: { children: { title: string }[] } };
    };
    expect(body.type).toBe('document');
    expect(body.source_changed).toBe(false);
    expect(body.document.sections.children[0].title).toBe('Guide');
    expect(textOf(read)).not.toContain('file://');
  });

  it('read_document on a non-md source returns the roadmap error',
    async () => {
      const read = await callOnce(
        testDeps(),
        (c) => c.callTool(
          'read_document', { resource: 'https://ex.com/r.pdf' },
        ),
      ) as { [x: string]: unknown };
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('markdown (.md) sources only');
    });
});
