import { createServer, type IncomingMessage, type ServerResponse } from
  'node:http';
import { CdpEngine } from './playwright-engine.js';
import { orchestrateFetch, type FetchInput } from './fetch-orchestrator.js';

const SERVICE_PORT = Number(process.env.SERVICE_PORT ?? 8932);
const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
// M9: version bump signals instruction protocol support. The host checks
// this via /healthz min-version gate (ADR-010 section 4.5).
const VERSION = process.env.DIGEST_VERSION ?? '0.3.0';

const engine = new CdpEngine(CDP_URL);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function validateInput(raw: unknown): FetchInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== 'string') return null;
  return {
    url: r.url,
    timeoutSeconds: typeof r.timeoutSeconds === 'number'
      ? r.timeoutSeconds : 30,
    rawOnly: r.rawOnly === true,
    validators: typeof r.validators === 'object' && r.validators !== null
      ? r.validators as FetchInput['validators'] : undefined,
    // M9: instruction field. Absent = legacy behaviour (backwards
    // compatible). Validated loosely: the service trusts the host.
    instruction: typeof r.instruction === 'object' && r.instruction !== null
      ? r.instruction as FetchInput['instruction'] : undefined,
  };
}

async function handle(
  req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  if (req.method === 'GET' && req.url === '/healthz') {
    const cdpConnected = await engine.isReady();
    sendJson(res, cdpConnected ? 200 : 503, {
      status: cdpConnected ? 'ok' : 'cdp-unavailable',
      cdpConnected,
      version: VERSION,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/fetch') {
    let input: FetchInput | null;
    try {
      input = validateInput(JSON.parse(await readBody(req)));
    } catch {
      sendJson(res, 400, { outcome: 'fetch-failed', reason: 'invalid JSON' });
      return;
    }
    if (!input) {
      sendJson(res, 400, {
        outcome: 'fetch-failed', reason: 'url required',
      });
      return;
    }
    try {
      const result = await orchestrateFetch(engine, input);
      const code = result.outcome === 'timeout' ? 504
        : result.outcome === 'fetch-failed' ? 502 : 200;
      sendJson(res, code, result);
    } catch (err) {
      sendJson(res, 502, {
        outcome: 'fetch-failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

server.listen(SERVICE_PORT, () => {
  process.stderr.write(
    `digest service on :${SERVICE_PORT}, CDP ${CDP_URL}\n`,
  );
});
