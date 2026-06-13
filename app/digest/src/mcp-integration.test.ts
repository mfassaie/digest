import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, close } from 'mcp-testing-kit';
import { createServer, type ServerDeps } from '@digest/mcp-server';
import { artefactId, createArtefactStore } from '@digest/shared';
import { DEFAULT_SETTINGS } from '@digest/shared/settings';
import { defaultDeps } from './deps.js';
import { getVersion } from './version.js';

// Integration: drive the wired MCP server over the protocol
// (mcp-testing-kit) with a fake network — schema validation, tool
// dispatch, the artefact store and host-side writing all run for real.

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'falk-mcp-')); });
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
  it('lists all registered tools', async () => {
    const result = await callOnce(
      testDeps(), (c) => c.listTools(),
    ) as { tools?: { name?: string }[] };
    const names = (result.tools ?? []).map((t) => t.name).sort();
    // M5 adds read_section, M6 adds write_section.
    expect(names).toEqual([
      'fetch_file', 'read_document', 'read_section', 'write_section',
    ]);
  });

  it('fetch_file then read_document works end-to-end through tool calls',
    async () => {
      const deps = testDeps();
      const fetched = await callOnce(
        deps, (c) => c.callTool('fetch_file', { uri: MD_URL }),
      ) as { [x: string]: unknown };
      const digest = JSON.parse(textOf(fetched)) as {
        id: string; type: string; file: { uri: string };
      };
      expect(digest.type).toBe('file');
      expect(digest.id).toBe(artefactId(MD_URL, 'file'));
      // fetch_file is the only tool that returns file uris.
      expect(digest.file.uri).toContain('file://');

      // A second server instance over the same store serves the read: the
      // artefact written by fetch_file is durable host-side state.
      const read = await callOnce(
        deps, (c) => c.callTool('read_document', {
          resource: MD_URL, read_mode: 'all',
        }),
      ) as { [x: string]: unknown };
      const body = JSON.parse(textOf(read)) as {
        type: string;
        source_changed: boolean;
        document: { sections: { children: { title: string }[] } };
      };
      expect(body.type).toBe('document');
      expect(body.source_changed).toBe(false);
      expect(body.document.sections.children[0].title).toBe('Guide');
      expect(textOf(read)).not.toContain('file://');
    });

  it('read_document by file id hops to the converted document', async () => {
    const deps = testDeps();
    await callOnce(deps, (c) => c.callTool('fetch_file', { uri: MD_URL }));
    await callOnce(
      deps, (c) => c.callTool('read_document', { resource: MD_URL }),
    );
    const hopped = await callOnce(
      deps, (c) => c.callTool('read_document', {
        resource: artefactId(MD_URL, 'file'),
      }),
    ) as { [x: string]: unknown };
    const body = JSON.parse(textOf(hopped)) as { id: string };
    expect(body.id).toBe(artefactId(MD_URL, 'document'));
  });

  it('read_document on an unsupported source returns an isError result',
    async () => {
      const read = await callOnce(
        testDeps(), (c) => c.callTool('read_document', {
          resource: 'https://ex.com/report.pdf',
        }),
      ) as { [x: string]: unknown };
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('application/pdf');
      expect(textOf(read)).toContain('roadmap');
    });
});

describe('defaultDeps wiring', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('builds the production deps shape', () => {
    // Hermetic: keep the machine's real user config and artefact root out.
    process.env.XDG_CONFIG_HOME = root;
    delete process.env.DIGEST_CONFIG;
    process.env.DIGEST_ARTEFACT_ROOT = join(root, 'artefacts');
    const deps = defaultDeps();
    expect(deps.store.paths.root).toBe(join(root, 'artefacts'));
    expect(deps.settings.types['*/*']).toBeDefined();
    expect(typeof deps.engine?.summarise).toBe('function');
    expect(deps.logsDir).toBe(join(root, 'artefacts', 'logs'));
  });
});
