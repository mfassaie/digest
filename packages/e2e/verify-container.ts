// Verification: the Docker container rendering path end-to-end. Routes an
// HTML fetch through the stealth browser in the container, verifies the
// section tree, validates the host-side timeout guarantee, and checks
// doctor output. Requires Docker Desktop running and the digest:local
// image built; skips cleanly when either is absent.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from
  'node:http';
import {
  detectDocker, imagePresent, realRunner, ensureContainer, containerFetch,
} from '@digest/docker';
import { handleFetchFile, handleReadDocument } from '@digest/mcp-server';
import {
  createArtefactStore, extractiveEngine,
  type ContainerTransport,
  type ContainerFetchRequest,
  type ContainerFetchResponse,
} from '@digest/shared';
import type { Settings } from '@digest/shared/settings';

// --- Docker availability gate -------------------------------------------

async function dockerReady(): Promise<boolean> {
  try {
    await detectDocker(realRunner);
    return await imagePresent(realRunner);
  } catch {
    return false;
  }
}

if (!await dockerReady()) {
  console.log(
    'SKIP: Docker is not available or digest:local image is not built.\n' +
    'Start Docker Desktop and run `npx digest setup`, then re-run.',
  );
  process.exit(0);
}

// --- Helpers ------------------------------------------------------------

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) process.exitCode = 1;
}

// Settings that force text/html through the container browser path.
const CONTAINER_SETTINGS: Settings = {
  types: {
    'text/html': {
      retrieval: 'browser', parser: 'defuddle',
      runtime: 'container', escalate: 'browser',
    },
    '*/*': {
      retrieval: 'http', parser: 'raw',
      runtime: 'local', escalate: 'none',
    },
  },
  chunking: {
    standard: {
      '*/*': { strategy: 'bytes', chunk_bytes: 1_048_576 },
    },
  },
  fetch: { timeout_seconds: 30, retries: 0 },
};

// Minimal settings with a very short timeout for the timeout test.
const TIMEOUT_SETTINGS: Settings = {
  ...CONTAINER_SETTINGS,
  fetch: { timeout_seconds: 2, retries: 0 },
};

// Container transport wired from @digest/docker (same as app/digest deps).
function createContainerTransport(): ContainerTransport {
  let cached: { baseUrl: string } | null = null;
  return {
    async ensure(): Promise<{ baseUrl: string }> {
      if (cached !== null) return cached;
      cached = await ensureContainer(realRunner);
      return cached;
    },
    async fetch(
      baseUrl: string, req: ContainerFetchRequest,
    ): Promise<ContainerFetchResponse> {
      return containerFetch(baseUrl, req);
    },
  };
}

// A local HTTP server serving a minimal HTML page. Using a local server
// avoids network dependency and gives control over the content.
function startLocalHtmlServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const html = [
      '<!DOCTYPE html>',
      '<html><head><title>Container E2E Test</title></head>',
      '<body>',
      '<h1>Container E2E</h1>',
      '<p>Preamble paragraph for extraction.</p>',
      '<h2>Section Alpha</h2>',
      '<p>Alpha content rendered by the stealth browser.</p>',
      '<h2>Section Beta</h2>',
      '<p>Beta content for the section tree.</p>',
      '</body></html>',
    ].join('\n');

    const server = createServer(
      (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      },
    );
    // Listen on all interfaces so the container can reach the host.
    server.listen(0, '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null
        ? addr.port : 0;
      // host.docker.internal resolves to the host from inside Docker
      // Desktop containers on Windows and macOS.
      const url = `http://host.docker.internal:${port}/test.html`;
      resolve({
        url,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

const root = mkdtempSync(join(tmpdir(), 'digest-container-'));
const transport = createContainerTransport();

async function main(): Promise<void> {
  const httpServer = await startLocalHtmlServer();
  try {
    // ----------------------------------------------------------------
    // Test 1: HTML fetch via container
    // ----------------------------------------------------------------
    console.log('--- Test 1: HTML fetch via container ---');
    const store1 = createArtefactStore(root);
    const deps1 = {
      store: store1,
      settings: CONTAINER_SETTINGS,
      engine: extractiveEngine,
      logsDir: join(root, 'logs'),
      containerTransport: transport,
    };

    const fetchResult = await handleFetchFile(
      { uri: httpServer.url }, deps1,
    );
    assert(!fetchResult.isError, 'fetch_file via container succeeds');

    const digest = JSON.parse(fetchResult.content[0].text) as {
      id: string;
      type: string;
      file: { mime_type: string };
    };
    assert(digest.type === 'file', 'fetch returns file-type artefact');
    assert(
      typeof digest.file.mime_type === 'string'
        && digest.file.mime_type.startsWith('text/'),
      `file.mime_type starts with text/ (got ${digest.file.mime_type})`,
    );

    // read_document should convert the HTML to a document with sections.
    const readResult = await handleReadDocument(
      { resource: httpServer.url, read_mode: 'all' }, deps1,
    );
    assert(!readResult.isError, 'read_document succeeds');

    const doc = JSON.parse(readResult.content[0].text) as {
      id: string;
      type: string;
      document?: {
        sections: { id: string; children?: unknown[] };
      };
    };
    assert(doc.type === 'document', 'read_document returns document-type');
    assert(
      doc.document !== undefined
        && doc.document.sections !== undefined,
      'document has a sections tree',
    );
    assert(
      doc.document !== undefined
        && Array.isArray(doc.document.sections.children)
        && doc.document.sections.children.length > 0,
      'section tree has children (h2 sections)',
    );

    // ----------------------------------------------------------------
    // Test 2: Container timeout (host-side abort guarantee)
    // ----------------------------------------------------------------
    console.log('\n--- Test 2: container timeout ---');
    // Use a fresh store so no SWR cache serves the prior fetch.
    const timeoutRoot = join(root, 'timeout-test');
    const store2 = createArtefactStore(timeoutRoot);
    const deps2 = {
      store: store2,
      settings: TIMEOUT_SETTINGS,
      engine: extractiveEngine,
      logsDir: join(timeoutRoot, 'logs'),
      containerTransport: transport,
    };

    // The host-side timeout is timeout_seconds + 10s (container-client).
    // With a 2s budget the total wall clock must stay under a generous
    // tolerance. We are testing that the pipeline does NOT hang, not that
    // the exact timeout fires to the millisecond.
    const toleranceMs = 30_000;
    const start = Date.now();
    const timeoutResult = await handleFetchFile(
      { uri: httpServer.url }, deps2,
    );
    const elapsed = Date.now() - start;

    // The fetch may succeed quickly (container already rendered) or fail
    // with a timeout. Either is acceptable; a hang is not.
    const bounded = elapsed < toleranceMs;
    assert(bounded,
      `fetch completed within tolerance (${elapsed}ms < ${toleranceMs}ms)`,
    );
    // If it succeeded, verify it returned a valid response.
    if (!timeoutResult.isError) {
      assert(
        timeoutResult.content[0].text.includes('"type"'),
        'timeout-budget fetch returned a parseable response',
      );
    } else {
      // A timeout error is acceptable.
      console.log(
        `  (returned error as expected: ` +
        `${timeoutResult.content[0].text.slice(0, 120)})`,
      );
    }

    // ----------------------------------------------------------------
    // Test 3: Doctor reports container status
    // ----------------------------------------------------------------
    console.log('\n--- Test 3: doctor reports container status ---');
    const pkgDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', 'app', 'digest',
    );
    const bin = join(pkgDir, 'dist', 'index.js');

    // Write a settings file that forces container runtime so doctor
    // reports Docker/Image as error-severity (required, not optional).
    const settingsFile = join(root, 'container-settings.json');
    writeFileSync(settingsFile, JSON.stringify({
      types: {
        'text/html': {
          runtime: 'container', retrieval: 'browser',
          parser: 'defuddle', escalate: 'browser',
        },
      },
    }));

    try {
      const out = execFileSync(process.execPath, [bin, 'doctor'], {
        env: {
          ...process.env,
          DIGEST_ARTEFACT_ROOT: root,
          DIGEST_CONFIG: settingsFile,
        },
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert(out.includes('OK  Docker'), 'doctor reports Docker: OK');
      assert(out.includes('OK  Image'), 'doctor reports Image: OK');
      assert(
        out.includes('All checks passed'),
        'doctor reports all checks passed',
      );
    } catch (err) {
      // execFileSync throws on non-zero exit; stdout is still available.
      const output = (err as { stdout?: string }).stdout ?? '';
      // If doctor ran but some other check failed, Docker/Image may
      // still be OK.
      const dockerOk = output.includes('OK  Docker');
      const imageOk = output.includes('OK  Image');
      assert(dockerOk, 'doctor reports Docker: OK (from error path)');
      assert(imageOk, 'doctor reports Image: OK (from error path)');
      if (!dockerOk || !imageOk) {
        console.log('doctor output:\n' + output.trim().slice(0, 600));
      }
    }

  } finally {
    await httpServer.close();
    rmSync(root, { recursive: true, force: true });
  }

  const passed = process.exitCode !== 1;
  console.log(passed
    ? '\nOK: container rendering verified'
    : '\nFAILED',
  );
  process.exit(passed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
