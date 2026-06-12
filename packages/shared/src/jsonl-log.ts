import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { isShortId } from './store/ids.js';

// Structured jsonl logs (ADR-011 design §3, plan M2): cli-client.jsonl,
// mcp-client.jsonl and doc-service.jsonl under <logs>, plus one
// per-document pipeline log under <logs>/docs/{artefact-id}/, opened at
// pipeline start (the artefact id is derivable before any network call).
// Writers take the logs dir as an injected parameter — env wiring stays in
// the app. Writing never throws (same stance as logLine): a broken log
// must not break the host.

export interface JsonlWriter {
  readonly path: string;
  // Appends one line: {ts, ...record}. Never throws.
  write(record: Record<string, unknown>): void;
}

export interface JsonlWriterOptions {
  now?: () => Date;
}

export function createJsonlWriter(
  filePath: string, options: JsonlWriterOptions = {},
): JsonlWriter {
  const now = options.now ?? (() => new Date());
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // write() below degrades to a no-op
  }
  return {
    path: filePath,
    write(record) {
      try {
        const line = JSON.stringify({ ts: now().toISOString(), ...record });
        appendFileSync(filePath, `${line}\n`);
      } catch {
        // never let logging break the host
      }
    },
  };
}

export type LogClient = 'cli' | 'mcp';

// <logs>/cli-client.jsonl | <logs>/mcp-client.jsonl
export function openClientLog(
  logsDir: string, client: LogClient, options?: JsonlWriterOptions,
): JsonlWriter {
  return createJsonlWriter(join(logsDir, `${client}-client.jsonl`), options);
}

// <logs>/doc-service.jsonl — the in-container service's output, mirrored
// by @digest/docker's log follower (was cloakbrowser.log).
export function openDocServiceLog(
  logsDir: string, options?: JsonlWriterOptions,
): JsonlWriter {
  return createJsonlWriter(join(logsDir, 'doc-service.jsonl'), options);
}

// <logs>/docs/{artefact-id}/pipeline.jsonl — opened at pipeline start. The
// id shape is asserted because it becomes a path segment.
export function openDocLog(
  logsDir: string, artefactIdValue: string, options?: JsonlWriterOptions,
): JsonlWriter {
  if (!isShortId(artefactIdValue)) {
    throw new Error(
      `invalid artefact id for doc log: ${JSON.stringify(artefactIdValue)}`,
    );
  }
  return createJsonlWriter(
    join(logsDir, 'docs', artefactIdValue, 'pipeline.jsonl'), options,
  );
}

// Mirror a line stream (e.g. `docker logs` stdout/stderr) into a jsonl
// writer as {ts, ...base, line} records. Empty lines are dropped; stream
// errors are swallowed (a dying follower must not take the host with it).
export function followLinesAsJsonl(
  stream: NodeJS.ReadableStream,
  writer: JsonlWriter,
  base: Record<string, unknown> = {},
): void {
  stream.on('error', () => {});
  const rl = createInterface({ input: stream });
  // Node's readline re-emits input errors on the interface; both ends need
  // a handler or the process dies on a follower hiccup.
  rl.on('error', () => {});
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    writer.write({ ...base, line });
  });
}
