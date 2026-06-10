import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normaliseUrl } from './url.js';
import {
  getCacheRoot, getCacheDir, writeContent,
  readCacheMeta, writeCacheMeta, readMarkdown, readStructure,
} from './cache.js';
import {
  ensureContainer, realRunner, DockerUnavailableError,
  type CommandRunner,
} from './docker.js';
import { containerFetch } from './container-client.js';
import { extractSection, formatOutline } from './structure.js';
import { extractiveEngine, type ReadEngine } from './read-engine.js';
import { formatGet, formatError, formatRedirect } from './response.js';
import { getVersion } from './version.js';
import { logLine, startBrowserLogFollower } from './logging.js';
import type { CacheMeta, ContainerFetchResponse } from './types.js';

const CONVERTER = 'defuddle';

export interface ServerDeps {
  runner: CommandRunner;
  cacheRoot: string;
  fetchFn: typeof containerFetch;
  ensureFn: typeof ensureContainer;
  engine: ReadEngine;
  // Called once the container is confirmed ready (starts the log follower).
  // Omitted in tests so no `docker logs` process is spawned.
  onContainerReady?: () => void;
}

function defaultDeps(): ServerDeps {
  return {
    runner: realRunner,
    cacheRoot: getCacheRoot(),
    fetchFn: containerFetch,
    ensureFn: ensureContainer,
    engine: extractiveEngine,
    onContainerReady: startBrowserLogFollower,
  };
}

type TextResult = {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
};

function text(body: string, isError = false): TextResult {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: body }] };
}

export async function handleGet(
  args: { uri: string; timeout_seconds?: number; raw_only?: boolean },
  deps: ServerDeps = defaultDeps(),
): Promise<TextResult> {
  const timeoutSeconds = args.timeout_seconds ?? 30;
  const rawOnly = args.raw_only ?? false;
  let normUrl: string;
  try {
    normUrl = normaliseUrl(args.uri);
  } catch {
    return text(formatError(args.uri, 'Invalid URL'), true);
  }
  const cacheDir = getCacheDir(normUrl, deps.cacheRoot);
  const existing = await readCacheMeta(cacheDir);

  let baseUrl: string;
  try {
    ({ baseUrl } = await deps.ensureFn(deps.runner, {}));
    deps.onContainerReady?.();
  } catch (err) {
    if (err instanceof DockerUnavailableError) {
      return text(formatError(args.uri, err.message), true);
    }
    throw err;
  }

  const res = await deps.fetchFn(baseUrl, {
    url: normUrl,
    timeoutSeconds,
    rawOnly,
    validators: existing
      ? { etag: existing.etag, lastModified: existing.lastModified }
      : undefined,
  });

  return await renderGet(res, normUrl, args.uri, cacheDir, existing);
}

async function renderGet(
  res: ContainerFetchResponse,
  normUrl: string,
  rawUri: string,
  cacheDir: string,
  existing: CacheMeta | null,
): Promise<TextResult> {
  switch (res.outcome) {
    case 'not-modified': {
      if (!existing) {
        return text(formatError(rawUri, 'cache validated but no entry'), true);
      }
      return text(await formatFromMeta(existing, cacheDir, 'cache (validated)'));
    }
    case 'cross-host-redirect':
      return text(formatRedirect(res.fromUrl, res.toUrl));
    case 'http-error':
      return text(formatError(rawUri, `HTTP ${res.status}`), true);
    case 'timeout':
      return text(formatError(rawUri, 'Timeout'), true);
    case 'fetch-failed':
      return text(formatError(rawUri, res.reason), true);
    case 'fetched': {
      const written = await writeContent(cacheDir, {
        ext: res.content.ext,
        raw: res.content.raw,
        markdown: res.content.markdown,
        sections: res.sections,
      });
      const meta: CacheMeta = {
        cacheVersion: 2,
        url: normUrl,
        finalUrl: res.finalUrl,
        contentType: res.contentType,
        category: res.category,
        converter: CONVERTER,
        fetchedAt: new Date().toISOString(),
        etag: res.etag,
        lastModified: res.lastModified,
        title: res.meta.title,
        description: res.meta.description,
        author: res.meta.author,
        published: res.meta.published,
        site: res.meta.site,
        language: res.meta.language,
        wordCount: res.meta.wordCount,
        image: res.meta.image,
        rawFile: written.rawFile,
        markdownFile: written.markdownFile,
        structureFile: written.structureFile,
      };
      await writeCacheMeta(cacheDir, meta);
      return text(formatGet({
        meta, dir: cacheDir, sections: res.sections,
        rawSize: written.rawSize, markdownSize: written.markdownSize,
        source: 'fresh',
      }));
    }
  }
}

async function formatFromMeta(
  meta: CacheMeta, cacheDir: string,
  source: 'fresh' | 'cache (validated)',
): Promise<string> {
  const sections = await readStructure(cacheDir) ?? [];
  const rawStat = await stat(join(cacheDir, meta.rawFile));
  let markdownSize: number | undefined;
  if (meta.markdownFile) {
    markdownSize = (await stat(join(cacheDir, meta.markdownFile))).size;
  }
  return formatGet({
    meta, dir: cacheDir, sections,
    rawSize: rawStat.size, markdownSize, source,
  });
}

export async function handleRead(
  args: { uri: string; mode?: string; section?: string },
  deps: ServerDeps = defaultDeps(),
): Promise<TextResult> {
  const mode = args.mode ?? 'sections';
  let normUrl: string;
  try {
    normUrl = normaliseUrl(args.uri);
  } catch {
    return text(formatError(args.uri, 'Invalid URL'), true);
  }
  const cacheDir = getCacheDir(normUrl, deps.cacheRoot);
  const meta = await readCacheMeta(cacheDir);
  if (!meta) {
    return text(
      `No cached document for ${args.uri}.\n` +
      'Run fetch first to fetch it.', true,
    );
  }
  if (!meta.markdownFile) {
    return text(
      `${args.uri} was fetched as a non-HTML/raw file ` +
      `(${meta.contentType}). No markdown to read; the raw file is at ` +
      `${cacheDir}/${meta.rawFile}.`, true,
    );
  }
  const markdown = await readMarkdown(cacheDir);
  if (markdown === null) {
    return text(formatError(args.uri, 'cached markdown missing'), true);
  }
  const sections = await readStructure(cacheDir) ?? [];

  switch (mode) {
    case 'full':
      return text(markdown);
    case 'summary': {
      const summary = deps.engine.summarise(markdown, 5);
      const out = meta.description
        ? `${meta.description}\n\n${summary}` : summary;
      return text(out || '(no extractable summary)');
    }
    case 'keywords':
      return text(deps.engine.keywords(markdown, 12).join(', ') || '(none)');
    case 'sections': {
      if (args.section) {
        const content = extractSection(markdown, sections, args.section);
        return content === null
          ? text(`No section matching "${args.section}". Available:\n` +
              formatOutline(sections), true)
          : text(content);
      }
      return text(`Sections (${sections.length}):\n` +
        formatOutline(sections));
    }
    default:
      return text(formatError(args.uri, `unknown mode: ${mode}`), true);
  }
}

export function createServer(deps?: ServerDeps) {
  const server = new McpServer({ name: 'digest', version: getVersion() });

  server.tool(
    'fetch',
    'Fetch a URL through a headless browser (JS rendered), convert HTML ' +
    'to structured Markdown on disk, and return metadata, file paths and a ' +
    'section outline. Non-HTML files are downloaded and their path returned.',
    {
      uri: z.string().describe('URL to fetch. HTTP auto-upgraded to HTTPS.'),
      timeout_seconds: z.number().optional().default(30)
        .describe('Hard timeout in seconds. Default 30.'),
      raw_only: z.boolean().optional().default(false)
        .describe('Download HTML as-is without conversion.'),
    },
    (args) => handleGet(args, deps),
  );

  server.tool(
    'read',
    'Read a previously fetched document from cache: a summary, the section ' +
    'outline (or one named section), keywords, or the full Markdown.',
    {
      uri: z.string().describe('URL previously fetched with fetch.'),
      mode: z.enum(['summary', 'sections', 'keywords', 'full'])
        .optional().default('sections')
        .describe('What to return. Default sections.'),
      section: z.string().optional()
        .describe('With mode=sections, return one section by slug or title.'),
    },
    (args) => handleRead(args, deps),
  );

  return server;
}

export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logLine('info', `digest ${getVersion()} ready (cache ${getCacheRoot()})`);
}
