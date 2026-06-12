import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createJsonlWriter, followLinesAsJsonl, openClientLog, openDocLog,
  openDocServiceLog, type JsonlWriter,
} from './jsonl-log.js';
import { mintGuid } from './store/ids.js';

const T0 = '2026-06-13T10:00:00.000Z';
const clock = { now: () => new Date(T0) };

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'falk-jsonl-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function lines(writer: JsonlWriter): Record<string, unknown>[] {
  return readFileSync(writer.path, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function until(cond: () => boolean): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > 2000) throw new Error('condition timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('createJsonlWriter', () => {
  it('appends one timestamped JSON record per line', () => {
    const writer = createJsonlWriter(join(root, 'a.jsonl'), clock);
    writer.write({ event: 'fetch_start', uri: 'https://x.dev/' });
    writer.write({ event: 'fetch_done', status: 200 });
    expect(lines(writer)).toEqual([
      { ts: T0, event: 'fetch_start', uri: 'https://x.dev/' },
      { ts: T0, event: 'fetch_done', status: 200 },
    ]);
  });

  it('puts ts first on each line', () => {
    const writer = createJsonlWriter(join(root, 'b.jsonl'), clock);
    writer.write({ event: 'x' });
    expect(readFileSync(writer.path, 'utf8').startsWith('{"ts":')).toBe(true);
  });

  it('creates intermediate directories', () => {
    const writer = createJsonlWriter(join(root, 'deep', 'dir', 'c.jsonl'));
    writer.write({ ok: true });
    expect(lines(writer)).toHaveLength(1);
  });

  it('never throws when the path is unwritable', () => {
    const bad = join(root, `bad${String.fromCharCode(0)}dir`, 'x.jsonl');
    const writer = createJsonlWriter(bad);
    expect(() => writer.write({ still: 'fine' })).not.toThrow();
  });

  it('never throws on unserialisable records', () => {
    const writer = createJsonlWriter(join(root, 'd.jsonl'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writer.write(circular)).not.toThrow();
  });
});

describe('log file names (design §3)', () => {
  it('openClientLog maps cli/mcp to {client}-client.jsonl', () => {
    expect(openClientLog(root, 'cli').path)
      .toBe(join(root, 'cli-client.jsonl'));
    expect(openClientLog(root, 'mcp').path)
      .toBe(join(root, 'mcp-client.jsonl'));
  });

  it('openDocServiceLog targets doc-service.jsonl', () => {
    expect(openDocServiceLog(root).path)
      .toBe(join(root, 'doc-service.jsonl'));
  });

  it('openDocLog opens logs/docs/{artefact-id}/ at pipeline start', () => {
    const id = mintGuid();
    const writer = openDocLog(root, id);
    expect(writer.path).toBe(join(root, 'docs', id, 'pipeline.jsonl'));
    // The per-document dir exists before anything is written.
    expect(existsSync(join(root, 'docs', id))).toBe(true);
    writer.write({ event: 'pipeline_start' });
    expect(lines(writer)[0]).toMatchObject({ event: 'pipeline_start' });
  });

  it('openDocLog rejects non-id path segments', () => {
    expect(() => openDocLog(root, '../escape')).toThrow(
      /invalid artefact id/,
    );
  });
});

describe('followLinesAsJsonl', () => {
  it('mirrors stream lines as {ts, ...base, line} records', async () => {
    const writer = createJsonlWriter(join(root, 'f.jsonl'), clock);
    const stream = new PassThrough();
    followLinesAsJsonl(stream, writer, { stream: 'stdout' });
    stream.write('first line\n');
    stream.write('sec');
    stream.write('ond line\n');
    stream.write('\n'); // empty lines are dropped
    stream.end('tail without newline');
    await until(() => existsSync(writer.path)
      && lines(writer).length >= 3);
    expect(lines(writer)).toEqual([
      { ts: T0, stream: 'stdout', line: 'first line' },
      { ts: T0, stream: 'stdout', line: 'second line' },
      { ts: T0, stream: 'stdout', line: 'tail without newline' },
    ]);
  });

  it('swallows stream errors instead of crashing the host', async () => {
    const writer = createJsonlWriter(join(root, 'g.jsonl'), clock);
    const stream = new PassThrough();
    followLinesAsJsonl(stream, writer);
    stream.write('before\n');
    await until(() => existsSync(writer.path) && lines(writer).length >= 1);
    stream.destroy(new Error('boom'));
    await new Promise((r) => setImmediate(r));
    expect(lines(writer)).toEqual([{ ts: T0, line: 'before' }]);
  });
});
